package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"axentis-taxi/services"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for React Native
	},
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
}

// passengerEntry caches passengers for a driver's active + queued orders to avoid DB queries on every 10ms update.
type passengerEntry struct {
	passengerIDs []string
	expiresAt    time.Time
}

type WSHandler struct {
	hub   *services.Hub
	db    *pgxpool.Pool
	mu    sync.RWMutex
	cache map[string]passengerEntry // driver user_id -> passenger
}

func NewWSHandler(hub *services.Hub, db *pgxpool.Pool) *WSHandler {
	return &WSHandler{hub: hub, db: db, cache: make(map[string]passengerEntry)}
}

func (h *WSHandler) Handle(c *gin.Context) {
	userID := c.Query("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id required"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := &services.Client{
		ID:   userID,
		Conn: conn,
		Send: make(chan []byte, 1024),
	}

	h.hub.Register(client)

	go h.writePump(client)
	h.readPump(client)
}

func (h *WSHandler) readPump(client *services.Client) {
	defer func() {
		h.hub.Unregister(client)
		client.Conn.Close()
	}()

	client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	client.Conn.SetPongHandler(func(string) error {
		client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, msg, err := client.Conn.ReadMessage()
		if err != nil {
			break
		}
		// Reset deadline on every incoming message (driver sends at 10ms intervals)
		client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		var data map[string]interface{}
		if err := json.Unmarshal(msg, &data); err != nil {
			continue
		}

		msgType, ok := data["type"].(string)
		if !ok {
			continue
		}

		switch msgType {
		case "ping":
			pong, _ := json.Marshal(map[string]string{"type": "pong"})
			client.Send <- pong
		case "location_update":
			// High-frequency driver location relay — forward to all active/queued passengers.
			lat, _ := data["lat"].(float64)
			lng, _ := data["lng"].(float64)
			heading := data["heading"] // may be nil

			// Persist location to DB so matching service can find this driver.
			// Throttled via the driver-side REST call, but WS also writes to cover the gap.
			h.db.Exec(context.Background(),
				`UPDATE drivers SET current_lat = $1, current_lng = $2, current_heading = $3, last_seen = NOW()
				 WHERE user_id = $4`,
				lat, lng, heading, client.ID,
			)

			locationMsg, _ := json.Marshal(map[string]interface{}{
				"type":    "driver_location",
				"lat":     lat,
				"lng":     lng,
				"heading": heading,
			})
			for _, pid := range h.getPassengersForDriver(client.ID) {
				h.hub.SendToUser(pid, locationMsg)
			}
		}
	}
}

// getPassengersForDriver returns passenger user_ids for the driver's active and queued orders.
// Results are cached for 3 seconds to avoid DB queries on every 10ms update.
func (h *WSHandler) getPassengersForDriver(driverUserID string) []string {
	h.mu.RLock()
	entry, ok := h.cache[driverUserID]
	h.mu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.passengerIDs
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT DISTINCT o.passenger_id::text FROM orders o
		 JOIN drivers d ON o.driver_id = d.id
		 WHERE d.user_id = $1 AND o.status IN ('accepted', 'arrived', 'in_progress', 'queued')
		 AND o.passenger_id IS NOT NULL`,
		driverUserID,
	)
	var ids []string
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var pid string
			if rows.Scan(&pid) == nil {
				ids = append(ids, pid)
			}
		}
	}

	h.mu.Lock()
	h.cache[driverUserID] = passengerEntry{passengerIDs: ids, expiresAt: time.Now().Add(3 * time.Second)}
	h.mu.Unlock()
	return ids
}

func (h *WSHandler) writePump(client *services.Client) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		client.Conn.Close()
	}()

	for {
		select {
		case msg, ok := <-client.Send:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := client.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

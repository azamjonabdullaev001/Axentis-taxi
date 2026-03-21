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

// passengerEntry caches the active passenger for a driver to avoid DB queries on every 10ms update.
type passengerEntry struct {
	passengerID string
	expiresAt   time.Time
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
			// High-frequency (10ms) driver location relay — no DB write, just forward to passenger.
			lat, _ := data["lat"].(float64)
			lng, _ := data["lng"].(float64)
			heading := data["heading"] // may be nil

			passengerID := h.getPassengerForDriver(client.ID)
			if passengerID != "" {
				msg, _ := json.Marshal(map[string]interface{}{
					"type":    "driver_location",
					"lat":     lat,
					"lng":     lng,
					"heading": heading,
				})
				h.hub.SendToUser(passengerID, msg)
			}
		}
	}
}

// getPassengerForDriver returns the passenger user_id for the driver's active order.
// Results are cached for 3 seconds to avoid DB queries on every 10ms update.
func (h *WSHandler) getPassengerForDriver(driverUserID string) string {
	h.mu.RLock()
	entry, ok := h.cache[driverUserID]
	h.mu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.passengerID
	}

	var passengerID string
	err := h.db.QueryRow(context.Background(),
		`SELECT o.passenger_id FROM orders o
		 JOIN drivers d ON o.driver_id = d.id
		 WHERE d.user_id = $1 AND o.status IN ('accepted', 'arrived', 'in_progress')
		 ORDER BY o.created_at DESC LIMIT 1`,
		driverUserID,
	).Scan(&passengerID)
	if err != nil {
		passengerID = ""
	}

	h.mu.Lock()
	h.cache[driverUserID] = passengerEntry{passengerID: passengerID, expiresAt: time.Now().Add(3 * time.Second)}
	h.mu.Unlock()
	return passengerID
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

package handlers

import (
	"encoding/json"
	"log"
	"net/http"
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
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type WSHandler struct {
	hub *services.Hub
	db  *pgxpool.Pool
}

func NewWSHandler(hub *services.Hub, db *pgxpool.Pool) *WSHandler {
	return &WSHandler{hub: hub, db: db}
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
		Send: make(chan []byte, 256),
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
			// Driver location broadcast handled via REST API
		}
	}
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

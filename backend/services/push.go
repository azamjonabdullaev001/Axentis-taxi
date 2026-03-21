package services

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const expoPushAPI = "https://exp.host/--/api/v2/push/send"

// PushService sends Expo push notifications (→ FCM on Android, → APNs on iOS).
// Works for backgrounded and killed apps via the Expo managed push pipeline.
type PushService struct {
	db     *pgxpool.Pool
	client *http.Client
}

func NewPushService(db *pgxpool.Pool) *PushService {
	return &PushService{
		db:     db,
		client: &http.Client{Timeout: 8 * time.Second},
	}
}

// SendNewOrderPush sends a push notification to a driver for an incoming order.
// Silently no-ops if the user has no registered token.
func (p *PushService) SendNewOrderPush(userID, pickupAddress, destAddress, orderID string) {
	var pushToken string
	if err := p.db.QueryRow(context.Background(),
		`SELECT push_token FROM users WHERE id = $1 AND push_token IS NOT NULL`,
		userID,
	).Scan(&pushToken); err != nil {
		return
	}
	if !isValidExpoPushToken(pushToken) {
		return
	}

	body := pickupAddress + " → " + destAddress
	if strings.TrimSpace(body) == "→" || strings.TrimSpace(body) == "" {
		body = "Новый заказ ожидает подтверждения"
	}

	p.send(map[string]interface{}{
		"to":        pushToken,
		"title":     "Новый заказ 🚕",
		"body":      body,
		"sound":     "default",
		"priority":  "high",
		"channelId": "orders",
		"data": map[string]string{
			"order_id": orderID,
			"type":     "new_order",
		},
	})
}

// SendOrderAcceptedPush notifies a passenger that their order was accepted.
func (p *PushService) SendOrderAcceptedPush(passengerID, driverName, carNumber string) {
	var pushToken string
	if err := p.db.QueryRow(context.Background(),
		`SELECT push_token FROM users WHERE id = $1 AND push_token IS NOT NULL`,
		passengerID,
	).Scan(&pushToken); err != nil {
		return
	}
	if !isValidExpoPushToken(pushToken) {
		return
	}

	p.send(map[string]interface{}{
		"to":        pushToken,
		"title":     "Водитель найден! 🚖",
		"body":      driverName + " · " + carNumber,
		"sound":     "default",
		"priority":  "high",
		"channelId": "orders",
		"data":      map[string]string{"type": "order_accepted"},
	})
}

func (p *PushService) send(payload interface{}) {
	b, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[push] marshal error: %v", err)
		return
	}
	req, err := http.NewRequest(http.MethodPost, expoPushAPI, bytes.NewBuffer(b))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "gzip, deflate")

	resp, err := p.client.Do(req)
	if err != nil {
		log.Printf("[push] HTTP error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[push] unexpected status from Expo push API: %d", resp.StatusCode)
	}
}

func isValidExpoPushToken(token string) bool {
	return strings.HasPrefix(token, "ExponentPushToken[") ||
		strings.HasPrefix(token, "ExpoPushToken[")
}

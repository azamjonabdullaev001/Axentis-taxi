package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"axentis-taxi/models"
	"axentis-taxi/services"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type FriendsHandler struct {
	db              *pgxpool.Pool
	hub             *services.Hub
	matchingService *services.MatchingService
	push            *services.PushService
}

func NewFriendsHandler(db *pgxpool.Pool, hub *services.Hub, push *services.PushService) *FriendsHandler {
	return &FriendsHandler{
		db:              db,
		hub:             hub,
		matchingService: services.NewMatchingService(db, hub, push),
		push:            push,
	}
}

// getMyDriverID resolves the caller's driver.id from their JWT user_id.
func (h *FriendsHandler) getMyDriverID(c *gin.Context) (string, bool) {
	userID := c.GetString("user_id")
	var driverID string
	err := h.db.QueryRow(context.Background(),
		`SELECT id FROM drivers WHERE user_id = $1`, userID,
	).Scan(&driverID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Driver profile not found"})
		return "", false
	}
	return driverID, true
}

// GET /drivers/search?phone=xxx
// Search a registered driver by exact phone number.
func (h *FriendsHandler) SearchDriver(c *gin.Context) {
	phone := c.Query("phone")
	if phone == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "phone required"})
		return
	}

	var r models.DriverSearchResult
	err := h.db.QueryRow(context.Background(),
		`SELECT d.id, d.user_id, u.first_name, u.last_name, u.phone, u.avatar_url, d.car_number
		 FROM drivers d
		 JOIN users u ON u.id = d.user_id
		 WHERE u.phone = $1 AND u.role = 'driver'
		 LIMIT 1`,
		phone,
	).Scan(&r.DriverID, &r.UserID, &r.FirstName, &r.LastName, &r.Phone, &r.AvatarURL, &r.CarNumber)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"driver": r})
}

// POST /driver/friends/request
// Send a friend request to another driver.
// Body: { "recipient_driver_id": "<uuid>" }
func (h *FriendsHandler) SendRequest(c *gin.Context) {
	userID := c.GetString("user_id")
	myDriverID, ok := h.getMyDriverID(c)
	if !ok {
		return
	}

	var req struct {
		RecipientDriverID string `json:"recipient_driver_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if myDriverID == req.RecipientDriverID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot add yourself"})
		return
	}

	// Verify recipient driver exists
	var exists bool
	_ = h.db.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM drivers WHERE id=$1)`, req.RecipientDriverID,
	).Scan(&exists)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Recipient driver not found"})
		return
	}

	var friendID string
	err := h.db.QueryRow(context.Background(),
		`INSERT INTO driver_friends (requester_id, recipient_id, status)
		 VALUES ($1, $2, 'pending')
		 ON CONFLICT (requester_id, recipient_id)
		 DO UPDATE SET status = 'pending', created_at = NOW()
		 RETURNING id`,
		myDriverID, req.RecipientDriverID,
	).Scan(&friendID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Notify recipient via WebSocket
	var recipientUserID string
	_ = h.db.QueryRow(context.Background(),
		`SELECT user_id FROM drivers WHERE id = $1`, req.RecipientDriverID,
	).Scan(&recipientUserID)
	if recipientUserID != "" {
		var firstName, lastName, phone string
		_ = h.db.QueryRow(context.Background(),
			`SELECT first_name, last_name, phone FROM users WHERE id = $1`, userID,
		).Scan(&firstName, &lastName, &phone)

		payload, _ := json.Marshal(map[string]interface{}{
			"type": "friend_request",
			"data": map[string]interface{}{
				"id":           friendID,
				"requester_id": myDriverID,
				"first_name":   firstName,
				"last_name":    lastName,
				"phone":        phone,
			},
		})
		h.hub.SendToUser(recipientUserID, payload)
	}

	c.JSON(http.StatusOK, gin.H{"id": friendID, "status": "pending"})
}

// PUT /driver/friends/:id/accept
// Accept an incoming friend request (only the recipient can call this).
func (h *FriendsHandler) AcceptRequest(c *gin.Context) {
	userID := c.GetString("user_id")
	friendID := c.Param("id")
	myDriverID, ok := h.getMyDriverID(c)
	if !ok {
		return
	}

	var requesterDriverID string
	err := h.db.QueryRow(context.Background(),
		`UPDATE driver_friends
		 SET status = 'accepted'
		 WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
		 RETURNING requester_id`,
		friendID, myDriverID,
	).Scan(&requesterDriverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Friend request not found or already processed"})
		return
	}

	// Notify requester that their request was accepted
	var requesterUserID string
	_ = h.db.QueryRow(context.Background(),
		`SELECT user_id FROM drivers WHERE id = $1`, requesterDriverID,
	).Scan(&requesterUserID)
	if requesterUserID != "" {
		var firstName, lastName string
		_ = h.db.QueryRow(context.Background(),
			`SELECT first_name, last_name FROM users WHERE id = $1`, userID,
		).Scan(&firstName, &lastName)

		payload, _ := json.Marshal(map[string]interface{}{
			"type": "friend_accepted",
			"data": map[string]interface{}{
				"first_name": firstName,
				"last_name":  lastName,
			},
		})
		h.hub.SendToUser(requesterUserID, payload)
	}

	c.JSON(http.StatusOK, gin.H{"status": "accepted"})
}

// DELETE /driver/friends/:id/decline
// Decline or remove a friend relationship (either party can call this).
func (h *FriendsHandler) DeclineRequest(c *gin.Context) {
	friendID := c.Param("id")
	myDriverID, ok := h.getMyDriverID(c)
	if !ok {
		return
	}

	_, err := h.db.Exec(context.Background(),
		`UPDATE driver_friends SET status = 'declined'
		 WHERE id = $1 AND (recipient_id = $2 OR requester_id = $2)`,
		friendID, myDriverID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "declined"})
}

// GET /driver/friends
// Returns accepted friends (bidirectional: I sent or received the request).
func (h *FriendsHandler) GetFriends(c *gin.Context) {
	myDriverID, ok := h.getMyDriverID(c)
	if !ok {
		return
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT df.id,
		        CASE WHEN df.requester_id=$1 THEN df.recipient_id ELSE df.requester_id END,
		        u.first_name, u.last_name, u.phone, u.avatar_url, d.car_number
		 FROM driver_friends df
		 JOIN drivers d ON d.id = CASE WHEN df.requester_id=$1 THEN df.recipient_id ELSE df.requester_id END
		 JOIN users u ON u.id = d.user_id
		 WHERE (df.requester_id=$1 OR df.recipient_id=$1) AND df.status = 'accepted'`,
		myDriverID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	friends := []models.FriendEntry{}
	for rows.Next() {
		var f models.FriendEntry
		if err := rows.Scan(&f.FriendshipID, &f.DriverID, &f.FirstName, &f.LastName, &f.Phone, &f.AvatarURL, &f.CarNumber); err != nil {
			continue
		}
		friends = append(friends, f)
	}
	c.JSON(http.StatusOK, gin.H{"friends": friends})
}

// GET /driver/friends/requests
// Returns pending incoming friend requests directed at me.
func (h *FriendsHandler) GetPendingRequests(c *gin.Context) {
	myDriverID, ok := h.getMyDriverID(c)
	if !ok {
		return
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT df.id, df.requester_id,
		        u.first_name, u.last_name, u.phone, u.avatar_url, d.car_number
		 FROM driver_friends df
		 JOIN drivers d ON d.id = df.requester_id
		 JOIN users u ON u.id = d.user_id
		 WHERE df.recipient_id = $1 AND df.status = 'pending'
		 ORDER BY df.created_at DESC`,
		myDriverID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	requests := []models.FriendRequest{}
	for rows.Next() {
		var r models.FriendRequest
		if err := rows.Scan(&r.RequestID, &r.RequesterID, &r.FirstName, &r.LastName, &r.Phone, &r.AvatarURL, &r.CarNumber); err != nil {
			continue
		}
		requests = append(requests, r)
	}
	c.JSON(http.StatusOK, gin.H{"requests": requests})
}

// POST /orders/:id/transfer
// Transfer an incoming (searching) order to a specific friend driver.
// Body: { "friend_driver_id": "<uuid>" }
func (h *FriendsHandler) TransferOrder(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only drivers can transfer orders"})
		return
	}
	orderID := c.Param("id")
	myDriverID, ok := h.getMyDriverID(c)
	if !ok {
		return
	}

	var req struct {
		FriendDriverID string `json:"friend_driver_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify friendship
	var friendshipCount int
	_ = h.db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM driver_friends
		 WHERE status = 'accepted'
		   AND ((requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1))`,
		myDriverID, req.FriendDriverID,
	).Scan(&friendshipCount)
	if friendshipCount == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a friend"})
		return
	}

	// Check order exists and is in a transferable state
	var status string
	var currentDriverID *string
	err := h.db.QueryRow(context.Background(),
		`SELECT status, driver_id FROM orders WHERE id = $1`, orderID,
	).Scan(&status, &currentDriverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}
	if status != "searching" && status != "accepted" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Order cannot be transferred at this stage"})
		return
	}
	// Ensure only the assigned driver (or a driver seeing a searching order) can transfer
	if currentDriverID != nil && *currentDriverID != myDriverID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not your order"})
		return
	}

	// Reset order to 'searching' — friend must explicitly accept via AcceptOrder
	_, err = h.db.Exec(context.Background(),
		`UPDATE orders SET driver_id = NULL, status = 'searching' WHERE id = $1`,
		orderID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Build new_order WS payload using the same query/format as the matching service
	type orderPayload struct {
		ID                 string  `json:"id"`
		PickupLat          float64 `json:"pickup_lat"`
		PickupLng          float64 `json:"pickup_lng"`
		PickupAddress      string  `json:"pickup_address"`
		DestinationLat     float64 `json:"destination_lat"`
		DestinationLng     float64 `json:"destination_lng"`
		DestinationAddress string  `json:"destination_address"`
		DistanceKm         float64 `json:"distance_km"`
		EstimatedPrice     float64 `json:"estimated_price"`
		LockedPricePerKm   float64 `json:"locked_price_per_km"`
		SurgeMultiplier    float64 `json:"surge_multiplier"`
		PassengerPhone     string  `json:"passenger_phone"`
		PassengerName      string  `json:"passenger_name"`
		PassengerPhoto     string  `json:"passenger_photo"`
		OrderType          string  `json:"order_type"`
		TripType           string  `json:"trip_type"`
		ServiceFee         float64 `json:"service_fee"`
		AdditionalInfo     string  `json:"additional_info"`
	}

	var od orderPayload
	var pickupLat, pickupLng float64
	_ = h.db.QueryRow(context.Background(),
		`SELECT o.id,
		        o.pickup_lat, o.pickup_lng, COALESCE(o.pickup_address,''),
		        COALESCE(o.destination_lat,0), COALESCE(o.destination_lng,0), COALESCE(o.destination_address,''),
		        COALESCE(o.distance_km,0), COALESCE(o.total_price,0), COALESCE(o.locked_price_per_km,0),
		        COALESCE(o.surge_multiplier,1.0),
		        COALESCE(u.phone, o.passenger_phone,''), COALESCE(u.first_name||' '||u.last_name,'Клиент'),
		        COALESCE(u.avatar_url,''), COALESCE(o.order_type,'app'), COALESCE(o.trip_type,'standard'),
		        COALESCE(o.service_fee,2000), COALESCE(o.additional_info,'')
		 FROM orders o
		 LEFT JOIN users u ON o.passenger_id = u.id
		 WHERE o.id = $1`,
		orderID,
	).Scan(
		&od.ID,
		&od.PickupLat, &od.PickupLng, &od.PickupAddress,
		&od.DestinationLat, &od.DestinationLng, &od.DestinationAddress,
		&od.DistanceKm, &od.EstimatedPrice, &od.LockedPricePerKm,
		&od.SurgeMultiplier,
		&od.PassengerPhone, &od.PassengerName, &od.PassengerPhoto,
		&od.OrderType, &od.TripType, &od.ServiceFee, &od.AdditionalInfo,
	)
	pickupLat = od.PickupLat
	pickupLng = od.PickupLng

	// Notify friend via WS
	var friendUserID string
	_ = h.db.QueryRow(context.Background(),
		`SELECT user_id FROM drivers WHERE id = $1`, req.FriendDriverID,
	).Scan(&friendUserID)
	if friendUserID != "" {
		wsMsg, _ := json.Marshal(map[string]interface{}{
			"type":  "new_order",
			"order": od,
		})
		h.hub.SendToUser(friendUserID, wsMsg)
		// Also send push notification (works even if friend's app is killed)
		go h.push.SendNewOrderPush(friendUserID, od.PickupAddress, od.DestinationAddress, od.ID)
	}

	// Notify original driver that the transfer was initiated
	userID := c.GetString("user_id")
	transferredMsg, _ := json.Marshal(map[string]interface{}{
		"type":     "order_transferred",
		"order_id": orderID,
	})
	h.hub.SendToUser(userID, transferredMsg)

	// Start 20s timeout goroutine: if friend doesn't accept, re-search nearby drivers
	go func() {
		time.Sleep(20 * time.Second)
		// Check if friend accepted the order
		var currentStatus string
		if e := h.db.QueryRow(context.Background(),
			`SELECT status FROM orders WHERE id = $1`, orderID,
		).Scan(&currentStatus); e != nil {
			return
		}
		if currentStatus != "searching" {
			// Friend accepted, declined, or order cancelled — nothing to do
			log.Printf("[TRANSFER %s] Friend responded (status=%s), no re-search needed", orderID, currentStatus)
			return
		}
		// Friend didn't respond in 20 seconds — re-search nearby drivers within 5 km
		log.Printf("[TRANSFER %s] Friend did not accept in 20s, re-searching nearby drivers", orderID)
		h.matchingService.FindAndNotifyDriversInRadius(orderID, pickupLat, pickupLng, 5000)
	}()

	c.JSON(http.StatusOK, gin.H{"status": "transferred"})
}

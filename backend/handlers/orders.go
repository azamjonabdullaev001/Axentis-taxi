package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"axentis-taxi/models"
	"axentis-taxi/services"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type OrderHandler struct {
	db             *pgxpool.Pool
	hub            *services.Hub
	pricingService *services.PricingService
	matchingService *services.MatchingService
}

func NewOrderHandler(db *pgxpool.Pool, hub *services.Hub, ps *services.PricingService) *OrderHandler {
	return &OrderHandler{
		db:              db,
		hub:             hub,
		pricingService:  ps,
		matchingService: services.NewMatchingService(db, hub),
	}
}

type CreateOrderRequest struct {
	PickupLat          float64 `json:"pickup_lat" binding:"required"`
	PickupLng          float64 `json:"pickup_lng" binding:"required"`
	PickupAddress      string  `json:"pickup_address"`
	DestinationLat     float64 `json:"destination_lat" binding:"required"`
	DestinationLng     float64 `json:"destination_lng" binding:"required"`
	DestinationAddress string  `json:"destination_address"`
	DistanceKm         float64 `json:"distance_km"`
}

func (h *OrderHandler) CreateOrder(c *gin.Context) {
	if c.GetString("user_role") != "passenger" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only passengers can create orders"})
		return
	}

	var req CreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	passengerID := c.GetString("user_id")
	basePrice, totalPrice, surge := h.pricingService.CalculatePrice(req.DistanceKm)

	var orderID string
	err := h.db.QueryRow(context.Background(),
		`INSERT INTO orders (passenger_id, pickup_lat, pickup_lng, pickup_address,
		 destination_lat, destination_lng, destination_address, distance_km,
		 base_price, total_price, surge_multiplier, service_fee, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 2000, 'searching')
		 RETURNING id`,
		passengerID, req.PickupLat, req.PickupLng, req.PickupAddress,
		req.DestinationLat, req.DestinationLng, req.DestinationAddress,
		req.DistanceKm, basePrice, totalPrice, surge,
	).Scan(&orderID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create order"})
		return
	}

	go h.matchingService.FindAndNotifyDrivers(orderID, req.PickupLat, req.PickupLng)

	c.JSON(http.StatusCreated, gin.H{
		"order_id":    orderID,
		"status":      "searching",
		"total_price": totalPrice,
		"surge":       surge,
	})
}

func (h *OrderHandler) GetOrder(c *gin.Context) {
	orderID := c.Param("id")
	userID := c.GetString("user_id")

	var o models.Order
	err := h.db.QueryRow(context.Background(),
		`SELECT o.id, o.passenger_id, o.driver_id, o.status,
		 o.pickup_lat, o.pickup_lng, COALESCE(o.pickup_address,''),
		 o.destination_lat, o.destination_lng, COALESCE(o.destination_address,''),
		 COALESCE(o.distance_km,0), COALESCE(o.base_price,0),
		 o.waiting_time_minutes, o.waiting_fee, o.service_fee, COALESCE(o.total_price,0),
		 o.surge_multiplier, o.created_at, o.accepted_at, o.arrived_at,
		 o.wait_started_at, o.started_at, o.completed_at, o.cancelled_at
		 FROM orders o WHERE o.id = $1 AND (o.passenger_id = $2 OR
		   EXISTS (SELECT 1 FROM drivers d WHERE d.id = o.driver_id AND d.user_id = $2))`,
		orderID, userID,
	).Scan(&o.ID, &o.PassengerID, &o.DriverID, &o.Status,
		&o.PickupLat, &o.PickupLng, &o.PickupAddress,
		&o.DestinationLat, &o.DestinationLng, &o.DestinationAddress,
		&o.DistanceKm, &o.BasePrice, &o.WaitingTimeMinutes, &o.WaitingFee,
		&o.ServiceFee, &o.TotalPrice, &o.SurgeMultiplier,
		&o.CreatedAt, &o.AcceptedAt, &o.ArrivedAt, &o.WaitStartedAt,
		&o.StartedAt, &o.CompletedAt, &o.CancelledAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}
	c.JSON(http.StatusOK, o)
}

func (h *OrderHandler) GetOrderHistory(c *gin.Context) {
	userID := c.GetString("user_id")
	role := c.GetString("user_role")

	var rows interface{}
	var err error

	if role == "passenger" {
		r, e := h.db.Query(context.Background(),
			`SELECT o.id, o.status, COALESCE(o.pickup_address,''), COALESCE(o.destination_address,''),
			 COALESCE(o.distance_km,0), COALESCE(o.total_price,0), o.created_at
			 FROM orders o WHERE o.passenger_id = $1
			 ORDER BY o.created_at DESC LIMIT 50`,
			userID)
		rows, err = r, e
		if err == nil {
			var orders []map[string]interface{}
			pgRows := r
			for pgRows.Next() {
				var id, status, pickup, dest string
				var dist, total float64
				var created time.Time
				pgRows.Scan(&id, &status, &pickup, &dest, &dist, &total, &created)
				orders = append(orders, map[string]interface{}{
					"id": id, "status": status, "pickup_address": pickup,
					"destination_address": dest, "distance_km": dist,
					"total_price": total, "created_at": created,
				})
			}
			_ = rows
			c.JSON(http.StatusOK, gin.H{"orders": orders})
		}
	} else {
		r, e := h.db.Query(context.Background(),
			`SELECT o.id, o.status, COALESCE(o.pickup_address,''), COALESCE(o.destination_address,''),
			 COALESCE(o.distance_km,0), COALESCE(o.total_price,0), o.created_at
			 FROM orders o
			 JOIN drivers d ON o.driver_id = d.id
			 WHERE d.user_id = $1
			 ORDER BY o.created_at DESC LIMIT 50`,
			userID)
		rows, err = r, e
		if err == nil {
			var orders []map[string]interface{}
			pgRows := r
			for pgRows.Next() {
				var id, status, pickup, dest string
				var dist, total float64
				var created time.Time
				pgRows.Scan(&id, &status, &pickup, &dest, &dist, &total, &created)
				orders = append(orders, map[string]interface{}{
					"id": id, "status": status, "pickup_address": pickup,
					"destination_address": dest, "distance_km": dist,
					"total_price": total, "created_at": created,
				})
			}
			_ = rows
			c.JSON(http.StatusOK, gin.H{"orders": orders})
		}
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get order history"})
	}
}

func (h *OrderHandler) AcceptOrder(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only drivers can accept orders"})
		return
	}
	orderID := c.Param("id")
	userID := c.GetString("user_id")

	var driverID string
	if err := h.db.QueryRow(context.Background(),
		`SELECT id FROM drivers WHERE user_id = $1`, userID,
	).Scan(&driverID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}

	tag, err := h.db.Exec(context.Background(),
		`UPDATE orders SET driver_id = $1, status = 'accepted', accepted_at = NOW()
		 WHERE id = $2 AND status = 'searching'`,
		driverID, orderID,
	)
	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Order no longer available"})
		return
	}

	h.db.Exec(context.Background(),
		`UPDATE drivers SET is_available = false WHERE id = $1`, driverID)

	var passengerID string
	h.db.QueryRow(context.Background(),
		`SELECT passenger_id FROM orders WHERE id = $1`, orderID,
	).Scan(&passengerID)

	var driverFirstName, driverLastName, driverPhone, driverCarNumber string
	h.db.QueryRow(context.Background(),
		`SELECT u.first_name, u.last_name, u.phone, d.car_number
		 FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.id = $1`,
		driverID,
	).Scan(&driverFirstName, &driverLastName, &driverPhone, &driverCarNumber)

	msg, _ := json.Marshal(map[string]interface{}{
		"type":      "order_accepted",
		"order_id":  orderID,
		"driver_id": driverID,
		"driver": map[string]string{
			"first_name": driverFirstName,
			"last_name":  driverLastName,
			"phone":      driverPhone,
			"car_number": driverCarNumber,
		},
	})
	h.hub.SendToUser(passengerID, msg)

	c.JSON(http.StatusOK, gin.H{"message": "Order accepted", "order_id": orderID})
}

func (h *OrderHandler) DeclineOrder(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "Order declined"})
}

func (h *OrderHandler) DriverArrived(c *gin.Context) {
	orderID := c.Param("id")
	userID := c.GetString("user_id")

	now := time.Now()
	tag, err := h.db.Exec(context.Background(),
		`UPDATE orders SET status = 'arrived', arrived_at = $1, wait_started_at = $1
		 WHERE id = $2 AND EXISTS (
		   SELECT 1 FROM drivers WHERE id = orders.driver_id AND user_id = $3
		 )`,
		now, orderID, userID,
	)
	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot update order"})
		return
	}

	var passengerID string
	h.db.QueryRow(context.Background(),
		`SELECT passenger_id FROM orders WHERE id = $1`, orderID,
	).Scan(&passengerID)

	msg, _ := json.Marshal(map[string]interface{}{
		"type":     "driver_arrived",
		"order_id": orderID,
	})
	h.hub.SendToUser(passengerID, msg)

	c.JSON(http.StatusOK, gin.H{"message": "Arrival confirmed", "free_wait_minutes": 2})
}

func (h *OrderHandler) StartTrip(c *gin.Context) {
	orderID := c.Param("id")
	userID := c.GetString("user_id")
	now := time.Now()

	var waitStarted *time.Time
	h.db.QueryRow(context.Background(),
		`SELECT wait_started_at FROM orders WHERE id = $1`, orderID,
	).Scan(&waitStarted)

	waitFee := h.pricingService.CalculateWaitFee(waitStarted, 2)

	tag, err := h.db.Exec(context.Background(),
		`UPDATE orders SET status = 'in_progress', started_at = $1, waiting_fee = $2
		 WHERE id = $3 AND EXISTS (
		   SELECT 1 FROM drivers WHERE id = orders.driver_id AND user_id = $4
		 )`,
		now, waitFee, orderID, userID,
	)
	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot start trip"})
		return
	}

	var passengerID string
	h.db.QueryRow(context.Background(),
		`SELECT passenger_id FROM orders WHERE id = $1`, orderID,
	).Scan(&passengerID)

	msg, _ := json.Marshal(map[string]interface{}{
		"type":       "trip_started",
		"order_id":   orderID,
		"waiting_fee": waitFee,
	})
	h.hub.SendToUser(passengerID, msg)

	c.JSON(http.StatusOK, gin.H{"message": "Trip started", "waiting_fee": waitFee})
}

func (h *OrderHandler) CompleteOrder(c *gin.Context) {
	orderID := c.Param("id")
	userID := c.GetString("user_id")
	now := time.Now()

	var waitFee, basePrice, serviceFee float64
	var waitStarted *time.Time
	h.db.QueryRow(context.Background(),
		`SELECT wait_started_at, COALESCE(base_price,0), service_fee
		 FROM orders WHERE id = $1`, orderID,
	).Scan(&waitStarted, &basePrice, &serviceFee)

	waitFee = h.pricingService.CalculateWaitFee(waitStarted, 2)
	totalPrice := basePrice + waitFee + serviceFee

	var driverID string
	tag, err := h.db.Exec(context.Background(),
		`UPDATE orders SET status = 'completed', completed_at = $1,
		 waiting_fee = $2, total_price = $3
		 WHERE id = $4 AND EXISTS (
		   SELECT 1 FROM drivers WHERE id = orders.driver_id AND user_id = $5
		 )`,
		now, waitFee, totalPrice, orderID, userID,
	)
	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot complete order"})
		return
	}

	h.db.QueryRow(context.Background(),
		`SELECT id FROM drivers WHERE user_id = $1`, userID,
	).Scan(&driverID)
	h.db.Exec(context.Background(),
		`UPDATE drivers SET is_available = true WHERE id = $1`, driverID)

	var passengerID string
	h.db.QueryRow(context.Background(),
		`SELECT passenger_id FROM orders WHERE id = $1`, orderID,
	).Scan(&passengerID)

	msg, _ := json.Marshal(map[string]interface{}{
		"type":        "trip_completed",
		"order_id":    orderID,
		"total_price": totalPrice,
	})
	h.hub.SendToUser(passengerID, msg)

	c.JSON(http.StatusOK, gin.H{
		"message":     "Trip completed",
		"total_price": totalPrice,
		"waiting_fee": waitFee,
	})
}

func (h *OrderHandler) CancelOrder(c *gin.Context) {
	orderID := c.Param("id")
	userID := c.GetString("user_id")

	tag, err := h.db.Exec(context.Background(),
		`UPDATE orders SET status = 'cancelled', cancelled_at = NOW()
		 WHERE id = $1 AND passenger_id = $2 AND status IN ('searching', 'accepted')`,
		orderID, userID,
	)
	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot cancel order"})
		return
	}

	var driverID *string
	h.db.QueryRow(context.Background(),
		`SELECT driver_id FROM orders WHERE id = $1`, orderID,
	).Scan(&driverID)

	if driverID != nil {
		var driverUserID string
		h.db.QueryRow(context.Background(),
			`SELECT user_id FROM drivers WHERE id = $1`, *driverID,
		).Scan(&driverUserID)

		msg, _ := json.Marshal(map[string]interface{}{
			"type":     "order_cancelled",
			"order_id": orderID,
		})
		h.hub.SendToUser(driverUserID, msg)

		h.db.Exec(context.Background(),
			`UPDATE drivers SET is_available = true WHERE id = $1`, *driverID)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Order cancelled"})
}

func (h *OrderHandler) UpdateDriverLocation(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Driver only"})
		return
	}
	var req struct {
		Lat float64 `json:"lat" binding:"required"`
		Lng float64 `json:"lng" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("user_id")
	h.db.Exec(context.Background(),
		`UPDATE drivers SET current_lat = $1, current_lng = $2, last_seen = NOW()
		 WHERE user_id = $3`,
		req.Lat, req.Lng, userID,
	)

	// Broadcast location to passenger of active order
	var passengerID, orderID string
	err := h.db.QueryRow(context.Background(),
		`SELECT o.passenger_id, o.id FROM orders o
		 JOIN drivers d ON o.driver_id = d.id
		 WHERE d.user_id = $1 AND o.status IN ('accepted', 'arrived', 'in_progress')
		 ORDER BY o.created_at DESC LIMIT 1`,
		userID,
	).Scan(&passengerID, &orderID)
	if err == nil {
		msg, _ := json.Marshal(map[string]interface{}{
			"type":     "driver_location",
			"order_id": orderID,
			"lat":      req.Lat,
			"lng":      req.Lng,
		})
		h.hub.SendToUser(passengerID, msg)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Location updated"})
}

func (h *OrderHandler) UpdateDriverAvailability(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Driver only"})
		return
	}
	var req struct {
		Available bool `json:"available"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userID := c.GetString("user_id")
	h.db.Exec(context.Background(),
		`UPDATE drivers SET is_available = $1 WHERE user_id = $2`,
		req.Available, userID,
	)
	c.JSON(http.StatusOK, gin.H{"available": req.Available})
}

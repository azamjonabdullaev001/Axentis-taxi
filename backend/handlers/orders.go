package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"axentis-taxi/models"
	"axentis-taxi/services"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type OrderHandler struct {
	db              *pgxpool.Pool
	hub             *services.Hub
	pricingService  *services.PricingService
	matchingService *services.MatchingService
	push            *services.PushService
}

func NewOrderHandler(db *pgxpool.Pool, hub *services.Hub, ps *services.PricingService, push *services.PushService) *OrderHandler {
	return &OrderHandler{
		db:              db,
		hub:             hub,
		pricingService:  ps,
		matchingService: services.NewMatchingService(db, hub, push),
		push:            push,
	}
}

type CreateOrderRequest struct {
	PickupLat          float64  `json:"pickup_lat" binding:"required"`
	PickupLng          float64  `json:"pickup_lng" binding:"required"`
	PickupAddress      string   `json:"pickup_address"`
	DestinationLat     *float64 `json:"destination_lat"`
	DestinationLng     *float64 `json:"destination_lng"`
	DestinationAddress string   `json:"destination_address"`
	DistanceKm         float64  `json:"distance_km"`
	TripType           string   `json:"trip_type"` // "standard" | "free"
}

type locationUpdateRequest struct {
	Lat     float64  `json:"lat" binding:"required"`
	Lng     float64  `json:"lng" binding:"required"`
	Heading *float64 `json:"heading"`
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

	// Reject orders with excessive distance (max 30 km)
	const maxOrderDistanceKm = 30.0
	if req.DistanceKm < 0 || req.DistanceKm > maxOrderDistanceKm {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Расстояние заказа (%.1f км) некорректно (макс %d км)", req.DistanceKm, int(maxOrderDistanceKm)),
		})
		return
	}

	// If destination is provided, verify actual distance via Haversine
	if req.DestinationLat != nil && req.DestinationLng != nil {
		straightLineDist := haversineMeters(req.PickupLat, req.PickupLng, *req.DestinationLat, *req.DestinationLng) / 1000
		if straightLineDist > maxOrderDistanceKm {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("Расстояние между точками (%.1f км) превышает максимум %d км", straightLineDist, int(maxOrderDistanceKm)),
			})
			return
		}
	}

	passengerID := c.GetString("user_id")
	basePrice, totalPrice, surge, serviceFee := h.pricingService.CalculatePrice(req.DistanceKm)
	lockedPerKm := h.pricingService.GetEffectivePricePerKm()

	tripType := req.TripType
	if tripType != "free" {
		tripType = "standard"
	}

	// For free-mode orders the passenger never sends a destination — store NULL
	var destLat, destLng interface{}
	var destAddr interface{}
	if tripType == "free" {
		destLat = nil
		destLng = nil
		destAddr = nil
	} else {
		destLat = req.DestinationLat
		destLng = req.DestinationLng
		destAddr = req.DestinationAddress
	}

	var orderID string
	err := h.db.QueryRow(context.Background(),
		`INSERT INTO orders (passenger_id, pickup_lat, pickup_lng, pickup_address,
		 destination_lat, destination_lng, destination_address, distance_km,
		 base_price, total_price, surge_multiplier, service_fee, status, trip_type, locked_price_per_km)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'searching', $13, $14)
		 RETURNING id`,
		passengerID, req.PickupLat, req.PickupLng, req.PickupAddress,
		destLat, destLng, destAddr,
		req.DistanceKm, basePrice, totalPrice, surge, serviceFee, tripType, lockedPerKm,
	).Scan(&orderID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create order"})
		return
	}

	go h.matchingService.FindAndNotifyDrivers(orderID, req.PickupLat, req.PickupLng)

	c.JSON(http.StatusCreated, gin.H{
		"order_id":             orderID,
		"status":               "searching",
		"total_price":          totalPrice,
		"surge":                surge,
		"locked_price_per_km":  lockedPerKm,
	})
}

func (h *OrderHandler) UpdateOrderDistance(c *gin.Context) {
	orderID := c.Param("id")
	userID := c.GetString("user_id")
	role := c.GetString("user_role")

	var req struct {
		DrivenKm float64 `json:"driven_km"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.DrivenKm < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid driven_km"})
		return
	}

	// Only allow distance to increase (prevent fraud)
	var currentDist float64
	h.db.QueryRow(context.Background(),
		`SELECT COALESCE(distance_km, 0) FROM orders WHERE id = $1`, orderID,
	).Scan(&currentDist)
	if req.DrivenKm < currentDist {
		c.JSON(http.StatusBadRequest, gin.H{"error": "distance cannot decrease"})
		return
	}

	if role == "passenger" {
		h.db.Exec(context.Background(),
			`UPDATE orders SET distance_km = $1
			 WHERE id = $2 AND trip_type = 'free' AND status = 'in_progress'
			 AND passenger_id = $3`,
			req.DrivenKm, orderID, userID,
		)
	} else if role == "driver" {
		h.db.Exec(context.Background(),
			`UPDATE orders SET distance_km = $1
			 WHERE id = $2 AND status IN ('in_progress', 'completed')
			 AND EXISTS (SELECT 1 FROM drivers WHERE id = orders.driver_id AND user_id = $3)`,
			req.DrivenKm, orderID, userID,
		)
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
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

	// Include driver info when order has a driver assigned (reconnect fallback)
	resp := gin.H{
		"id":                    o.ID,
		"passenger_id":          o.PassengerID,
		"driver_id":             o.DriverID,
		"status":                o.Status,
		"pickup_lat":            o.PickupLat,
		"pickup_lng":            o.PickupLng,
		"pickup_address":        o.PickupAddress,
		"destination_lat":       o.DestinationLat,
		"destination_lng":       o.DestinationLng,
		"destination_address":   o.DestinationAddress,
		"distance_km":           o.DistanceKm,
		"base_price":            o.BasePrice,
		"waiting_time_minutes":  o.WaitingTimeMinutes,
		"waiting_fee":           o.WaitingFee,
		"service_fee":           o.ServiceFee,
		"total_price":           o.TotalPrice,
		"surge_multiplier":      o.SurgeMultiplier,
		"created_at":            o.CreatedAt,
		"accepted_at":           o.AcceptedAt,
		"arrived_at":            o.ArrivedAt,
		"wait_started_at":       o.WaitStartedAt,
		"started_at":            o.StartedAt,
		"completed_at":          o.CompletedAt,
		"cancelled_at":          o.CancelledAt,
	}

	if o.DriverID != nil && *o.DriverID != "" {
		var firstName, lastName, phone, carNumber, avatarURL string
		var avgRating float64
		var ratingCount int
		h.db.QueryRow(context.Background(),
			`SELECT COALESCE(u.first_name,''), COALESCE(u.last_name,''), COALESCE(u.phone,''),
			 COALESCE(d.car_number,''), COALESCE(u.avatar_url,''),
			 COALESCE(d.average_rating, 5.0), COALESCE(d.rating_count, 0)
			 FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.id = $1`,
			*o.DriverID,
		).Scan(&firstName, &lastName, &phone, &carNumber, &avatarURL, &avgRating, &ratingCount)
		resp["driver"] = gin.H{
			"first_name":     firstName,
			"last_name":      lastName,
			"phone":          phone,
			"car_number":     carNumber,
			"avatar_url":     avatarURL,
			"average_rating": avgRating,
			"rating_count":   ratingCount,
		}
	}

	c.JSON(http.StatusOK, resp)
}

func (h *OrderHandler) GetOrderHistory(c *gin.Context) {
	userID := c.GetString("user_id")
	role := c.GetString("user_role")

	var rows interface{}
	var err error

	if role == "passenger" {
		r, e := h.db.Query(context.Background(),
			`SELECT o.id, o.status, COALESCE(o.pickup_address,''), COALESCE(o.destination_address,''),
			 COALESCE(o.distance_km,0), COALESCE(o.total_price,0), o.created_at,
			 COALESCE(o.destination_lat,0), COALESCE(o.destination_lng,0), COALESCE(d.car_number,''),
			 o.pickup_lat, o.pickup_lng
			 FROM orders o
			 LEFT JOIN drivers d ON o.driver_id = d.id
			 WHERE o.passenger_id = $1
			 ORDER BY o.created_at DESC LIMIT 50`,
			userID)
		rows, err = r, e
		if err == nil {
			defer r.Close()
			var orders []map[string]interface{}
			pgRows := r
			for pgRows.Next() {
				var id, status, pickup, dest, carNum string
				var dist, total, destLat, destLng, pickLat, pickLng float64
				var created time.Time
				pgRows.Scan(&id, &status, &pickup, &dest, &dist, &total, &created, &destLat, &destLng, &carNum, &pickLat, &pickLng)
				orders = append(orders, map[string]interface{}{
					"id": id, "status": status, "pickup_address": pickup,
					"destination_address": dest, "distance_km": dist,
					"total_price": total, "created_at": created,
					"destination_lat": destLat, "destination_lng": destLng,
					"car_number": carNum,
					"pickup_lat": pickLat, "pickup_lng": pickLng,
				})
			}
			_ = rows
			c.JSON(http.StatusOK, gin.H{"orders": orders})
		}
	} else {
		r, e := h.db.Query(context.Background(),
			`SELECT o.id, o.status, COALESCE(o.pickup_address,''), COALESCE(o.destination_address,''),
			 COALESCE(o.distance_km,0), COALESCE(o.total_price,0), o.created_at,
			 COALESCE(o.destination_lat,0), COALESCE(o.destination_lng,0),
			 o.pickup_lat, o.pickup_lng
			 FROM orders o
			 JOIN drivers d ON o.driver_id = d.id
			 WHERE d.user_id = $1
			 ORDER BY o.created_at DESC LIMIT 50`,
			userID)
		rows, err = r, e
		if err == nil {
			defer r.Close()
			var orders []map[string]interface{}
			pgRows := r
			for pgRows.Next() {
				var id, status, pickup, dest string
				var dist, total, destLat, destLng, pickLat, pickLng float64
				var created time.Time
				pgRows.Scan(&id, &status, &pickup, &dest, &dist, &total, &created, &destLat, &destLng, &pickLat, &pickLng)
				orders = append(orders, map[string]interface{}{
					"id": id, "status": status, "pickup_address": pickup,
					"destination_address": dest, "distance_km": dist,
					"total_price": total, "created_at": created,
					"destination_lat": destLat, "destination_lng": destLng,
					"pickup_lat": pickLat, "pickup_lng": pickLng,
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
	ctx := context.Background()

	var driverID string
	if err := h.db.QueryRow(ctx,
		`SELECT id FROM drivers WHERE user_id = $1`, userID,
	).Scan(&driverID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}

	// Check if driver already has an active order running
	var activeOrderCount int
	h.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM orders WHERE driver_id = $1 AND status IN ('accepted', 'arrived', 'in_progress')`,
		driverID,
	).Scan(&activeOrderCount)

	isQueued := activeOrderCount > 0
	newStatus := "accepted"
	if isQueued {
		newStatus = "queued"
	}

	tag, err := h.db.Exec(ctx,
		`UPDATE orders SET driver_id = $1, status = $2, accepted_at = NOW()
		 WHERE id = $3 AND status = 'searching'`,
		driverID, newStatus, orderID,
	)
	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Order no longer available"})
		return
	}

	// Release the per-driver lock in the matching service (order is accepted, no longer pending)
	h.matchingService.UnlockDriverForOrder(driverID, orderID)

	// Mark driver unavailable only when taking the first order (the active one)
	if !isQueued {
		h.db.Exec(ctx, `UPDATE drivers SET is_available = false WHERE id = $1`, driverID)
	}

	var passengerID *string
	h.db.QueryRow(ctx,
		`SELECT passenger_id FROM orders WHERE id = $1`, orderID,
	).Scan(&passengerID)

	var driverFirstName, driverLastName, driverPhone, driverCarNumber string
	var driverAvatarURL *string
	var driverAvgRating float64
	var driverRatingCount int
	h.db.QueryRow(ctx,
		`SELECT u.first_name, u.last_name, u.phone, d.car_number, u.avatar_url,
		 COALESCE(d.average_rating, 5.0), COALESCE(d.rating_count, 0)
		 FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.id = $1`,
		driverID,
	).Scan(&driverFirstName, &driverLastName, &driverPhone, &driverCarNumber, &driverAvatarURL,
		&driverAvgRating, &driverRatingCount)

	avatarStr := ""
	if driverAvatarURL != nil {
		avatarStr = *driverAvatarURL
	}

	msgData := map[string]interface{}{
		"type":      "order_accepted",
		"order_id":  orderID,
		"driver_id": driverID,
		"queued":    isQueued,
		"driver": map[string]interface{}{
			"first_name":     driverFirstName,
			"last_name":      driverLastName,
			"phone":          driverPhone,
			"car_number":     driverCarNumber,
			"avatar_url":     avatarStr,
			"average_rating": driverAvgRating,
			"rating_count":   driverRatingCount,
		},
	}

	// If queued: include destination of driver's current active order so passenger can track
	if isQueued {
		var prevDestLat, prevDestLng *float64
		var prevDestAddress string
		h.db.QueryRow(ctx,
			`SELECT destination_lat, destination_lng, COALESCE(destination_address,'')
			 FROM orders WHERE driver_id = $1 AND status IN ('accepted', 'arrived', 'in_progress')
			 ORDER BY created_at DESC LIMIT 1`,
			driverID,
		).Scan(&prevDestLat, &prevDestLng, &prevDestAddress)
		msgData["prev_dest_lat"] = prevDestLat
		msgData["prev_dest_lng"] = prevDestLng
		msgData["prev_dest_address"] = prevDestAddress
	}

	msg, _ := json.Marshal(msgData)
	if passengerID != nil {
		h.hub.SendToUser(*passengerID, msg)
		go h.push.SendOrderAcceptedPush(
			*passengerID,
			driverFirstName+" "+driverLastName,
			driverCarNumber,
		)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Order accepted", "order_id": orderID, "queued": isQueued})
}

func (h *OrderHandler) DeclineOrder(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only drivers can decline orders"})
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

	// Release the per-driver lock so matching service can offer other orders
	h.matchingService.UnlockDriverForOrder(driverID, orderID)

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

	var passengerID *string
	h.db.QueryRow(context.Background(),
		`SELECT passenger_id FROM orders WHERE id = $1`, orderID,
	).Scan(&passengerID)

	if passengerID != nil {
		msg, _ := json.Marshal(map[string]interface{}{
			"type":     "driver_arrived",
			"order_id": orderID,
		})
		h.hub.SendToUser(*passengerID, msg)
	}

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

	var passengerID *string
	h.db.QueryRow(context.Background(),
		`SELECT passenger_id FROM orders WHERE id = $1`, orderID,
	).Scan(&passengerID)

	if passengerID != nil {
		msg, _ := json.Marshal(map[string]interface{}{
			"type":       "trip_started",
			"order_id":   orderID,
			"waiting_fee": waitFee,
		})
		h.hub.SendToUser(*passengerID, msg)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Trip started", "waiting_fee": waitFee})
}

func (h *OrderHandler) CompleteOrder(c *gin.Context) {
	orderID := c.Param("id")
	userID := c.GetString("user_id")
	now := time.Now()

	var waitFee, storedTotalPrice, serviceFee, lockedPerKm, distKm float64
	var waitStarted *time.Time
	var tripType, currentStatus string
	if err := h.db.QueryRow(context.Background(),
		`SELECT wait_started_at, service_fee,
		 COALESCE(locked_price_per_km,0), COALESCE(distance_km,0), COALESCE(trip_type,'standard'),
		 COALESCE(total_price,0), status
		 FROM orders WHERE id = $1`, orderID,
	).Scan(&waitStarted, &serviceFee, &lockedPerKm, &distKm, &tripType, &storedTotalPrice, &currentStatus); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	if currentStatus == "cancelled" || currentStatus == "completed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Order already " + currentStatus})
		return
	}

	waitFee = h.pricingService.CalculateWaitFee(waitStarted, 2)
	var totalPrice float64
	if tripType == "free" {
		// Free tariff: use locked_price_per_km that was set at order creation.
		// The locked rate already reflects the current tariff at creation time.
		// Do NOT re-apply surge — it was already factored into locked_price_per_km.
		var effectivePerKm, effectiveServiceFee float64
		if lockedPerKm > 0 {
			effectivePerKm = lockedPerKm
			effectiveServiceFee = serviceFee
		} else {
			ps, psErr := h.pricingService.GetSettings()
			if psErr == nil {
				surge := ps.SurgeMultiplier
				if surge <= 0 {
					surge = 1.0
				}
				effectivePerKm = ps.PricePerKm * surge
				effectiveServiceFee = ps.ServiceFee
			} else {
				effectivePerKm = 3000
				effectiveServiceFee = 2000
			}
		}
		// Round driven distance to nearest 100m block (minimum 100m)
		distMeters := distKm * 1000
		if distMeters < 1 {
			distMeters = 100
		}
		roundedKm := math.Ceil(distMeters/100) * 100 / 1000
		raw := effectiveServiceFee + roundedKm*effectivePerKm + waitFee
		// Round to nearest 100 sum (more precise than 200)
		totalPrice = math.Ceil(raw/100) * 100
	} else {
		// Standard tariff: use total_price locked at order creation (includes service_fee + surge).
		// Only add wait_fee on top — never recalculate, never lose service_fee or surge.
		totalPrice = math.Ceil((storedTotalPrice+waitFee)/200) * 200
	}

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

	// ── Bonus processing ─────────────────────────────────────────────────────
	h.applyCompletionBonuses(driverID, userID, orderID, totalPrice, now)

	// ── Commission deduction from driver balance ─────────────────────────────
	var serviceSharePct float64
	var balanceExempt bool
	h.db.QueryRow(context.Background(),
		`SELECT COALESCE(service_share_pct, 10.0) FROM price_settings ORDER BY id LIMIT 1`,
	).Scan(&serviceSharePct)
	h.db.QueryRow(context.Background(),
		`SELECT COALESCE(balance_exempt, false) FROM drivers WHERE id = $1`, driverID,
	).Scan(&balanceExempt)
	if !balanceExempt && serviceSharePct > 0 {
		commission := totalPrice * serviceSharePct / 100
		h.db.Exec(context.Background(),
			`UPDATE drivers SET balance = balance - $1 WHERE id = $2`, commission, driverID)
		h.db.Exec(context.Background(),
			`INSERT INTO balance_transactions (driver_id, amount, tx_type, description, order_id)
			 VALUES ($1, $2, 'commission', $3, $4)`,
			driverID, -commission,
			fmt.Sprintf("Комиссия %.0f%% — %.0f сум", serviceSharePct, commission), orderID)
		// Notify driver about balance change
		var newBalance float64
		h.db.QueryRow(context.Background(), `SELECT COALESCE(balance,0) FROM drivers WHERE id = $1`, driverID).Scan(&newBalance)
		balMsg, _ := json.Marshal(map[string]interface{}{
			"type": "balance_updated", "balance": newBalance, "commission": commission, "tx_type": "commission",
		})
		h.hub.SendToUser(userID, balMsg)
	}

	var passengerID *string
	h.db.QueryRow(context.Background(),
		`SELECT passenger_id FROM orders WHERE id = $1`, orderID,
	).Scan(&passengerID)

	if passengerID != nil {
		msg, _ := json.Marshal(map[string]interface{}{
			"type":        "trip_completed",
			"order_id":    orderID,
			"total_price": totalPrice,
		})
		h.hub.SendToUser(*passengerID, msg)
	}

	// Promote queued order → accepted now that driver is free
	var queuedOrderID string
	var queuedPassengerID *string
	queuedErr := h.db.QueryRow(context.Background(),
		`UPDATE orders SET status = 'accepted', accepted_at = NOW()
		 WHERE driver_id = $1 AND status = 'queued'
		 RETURNING id, passenger_id`,
		driverID,
	).Scan(&queuedOrderID, &queuedPassengerID)

	if queuedErr == nil {
		// Notify queued passenger: their trip is now active
		if queuedPassengerID != nil {
			paxMsg, _ := json.Marshal(map[string]interface{}{
				"type":     "order_activated",
				"order_id": queuedOrderID,
			})
			h.hub.SendToUser(*queuedPassengerID, paxMsg)
		}

		// Fetch queued order details to send to driver
		var qPickupLat, qPickupLng float64
		var qPickupAddr, qDestAddr, qPassengerPhone, qPassengerName string
		var qDestLat, qDestLng *float64
		h.db.QueryRow(context.Background(),
			`SELECT o.pickup_lat, o.pickup_lng, COALESCE(o.pickup_address,''),
			 o.destination_lat, o.destination_lng, COALESCE(o.destination_address,''),
			 COALESCE(u.phone, o.passenger_phone,''), COALESCE(u.first_name || ' ' || u.last_name, 'Клиент')
			 FROM orders o LEFT JOIN users u ON o.passenger_id = u.id
			 WHERE o.id = $1`,
			queuedOrderID,
		).Scan(&qPickupLat, &qPickupLng, &qPickupAddr, &qDestLat, &qDestLng, &qDestAddr, &qPassengerPhone, &qPassengerName)

		driverMsg, _ := json.Marshal(map[string]interface{}{
			"type":     "queued_order_activated",
			"order_id": queuedOrderID,
			"order": map[string]interface{}{
				"id":                  queuedOrderID,
				"pickup_lat":          qPickupLat,
				"pickup_lng":          qPickupLng,
				"pickup_address":      qPickupAddr,
				"destination_lat":     qDestLat,
				"destination_lng":     qDestLng,
				"destination_address": qDestAddr,
				"passenger_phone":     qPassengerPhone,
				"passenger_name":      qPassengerName,
			},
		})
		h.hub.SendToUser(userID, driverMsg)
	}

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
		 WHERE id = $1 AND passenger_id = $2 AND status IN ('searching', 'accepted', 'queued')`,
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
	var req locationUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("user_id")
	h.db.Exec(context.Background(),
		`UPDATE drivers SET current_lat = $1, current_lng = $2, current_heading = $3, last_seen = NOW()
		 WHERE user_id = $4`,
		req.Lat, req.Lng, req.Heading, userID,
	)

	// Broadcast location to passenger of active order
	var passengerID *string
	var orderID, orderStatus string
	var destLat, destLng *float64
	err := h.db.QueryRow(context.Background(),
		`SELECT o.passenger_id, o.id, o.status, o.destination_lat, o.destination_lng
		 FROM orders o
		 JOIN drivers d ON o.driver_id = d.id
		 WHERE d.user_id = $1 AND o.status IN ('accepted', 'arrived', 'in_progress')
		 ORDER BY o.created_at DESC LIMIT 1`,
		userID,
	).Scan(&passengerID, &orderID, &orderStatus, &destLat, &destLng)
	if err == nil && passengerID != nil {
		msg, _ := json.Marshal(map[string]interface{}{
			"type":     "driver_location",
			"order_id": orderID,
			"lat":      req.Lat,
			"lng":      req.Lng,
			"heading":  req.Heading,
		})
		h.hub.SendToUser(*passengerID, msg)

		// Destination proximity check: notify when driver is within 100m of destination
		if orderStatus == "in_progress" && destLat != nil && destLng != nil {
			dist := haversineMeters(req.Lat, req.Lng, *destLat, *destLng)
			if dist <= 100 {
				reachedMsg, _ := json.Marshal(map[string]interface{}{
					"type":     "destination_reached",
					"order_id": orderID,
					"distance": dist,
				})
				h.hub.SendToUser(*passengerID, reachedMsg)
				h.hub.SendToUser(userID, reachedMsg)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Location updated"})
}

func (h *OrderHandler) UpdatePassengerLocation(c *gin.Context) {
	if c.GetString("user_role") != "passenger" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Passenger only"})
		return
	}

	var req locationUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("user_id")

	var shareLiveLocation bool
	if err := h.db.QueryRow(context.Background(),
		`SELECT share_live_location FROM users WHERE id = $1`, userID,
	).Scan(&shareLiveLocation); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	_, err := h.db.Exec(context.Background(),
		`UPDATE users SET current_lat = $1, current_lng = $2, current_heading = $3, last_location_at = NOW(), updated_at = NOW()
		 WHERE id = $4`,
		req.Lat, req.Lng, req.Heading, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update passenger location"})
		return
	}

	if shareLiveLocation {
		h.notifyPassengerLocationToDriver(userID, req.Lat, req.Lng, req.Heading)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Passenger location updated", "shared": shareLiveLocation})
}

func (h *OrderHandler) UpdatePassengerLocationSharing(c *gin.Context) {
	if c.GetString("user_role") != "passenger" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Passenger only"})
		return
	}

	var req struct {
		ShareLiveLocation bool `json:"share_live_location"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("user_id")
	_, err := h.db.Exec(context.Background(),
		`UPDATE users SET share_live_location = $1, updated_at = NOW() WHERE id = $2`,
		req.ShareLiveLocation, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update live location preference"})
		return
	}

	if req.ShareLiveLocation {
		var lat, lng float64
		var heading *float64
		if err := h.db.QueryRow(context.Background(),
			`SELECT current_lat, current_lng, current_heading FROM users WHERE id = $1 AND current_lat IS NOT NULL AND current_lng IS NOT NULL`,
			userID,
		).Scan(&lat, &lng, &heading); err == nil {
			h.notifyPassengerLocationToDriver(userID, lat, lng, heading)
		}
	} else {
		h.notifyPassengerLocationHiddenToDriver(userID)
	}

	c.JSON(http.StatusOK, gin.H{"share_live_location": req.ShareLiveLocation})
}

func (h *OrderHandler) GetAvailableDrivers(c *gin.Context) {
	if c.GetString("user_role") != "passenger" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Passenger only"})
		return
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT user_id, current_lat, current_lng, current_heading
		 FROM drivers
		 WHERE is_available = true
		   AND current_lat IS NOT NULL
		   AND current_lng IS NOT NULL
		   AND COALESCE(registration_status, 'approved') = 'approved'
		   AND last_seen > NOW() - INTERVAL '2 hours'
		 ORDER BY last_seen DESC
		 LIMIT 200`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load drivers"})
		return
	}
	defer rows.Close()

	type driverLocation struct {
		UserID  string   `json:"user_id"`
		Lat     float64  `json:"lat"`
		Lng     float64  `json:"lng"`
		Heading *float64 `json:"heading,omitempty"`
	}

	drivers := make([]driverLocation, 0)
	for rows.Next() {
		var item driverLocation
		if err := rows.Scan(&item.UserID, &item.Lat, &item.Lng, &item.Heading); err != nil {
			continue
		}
		drivers = append(drivers, item)
	}

	c.JSON(http.StatusOK, gin.H{"drivers": drivers})
}

func (h *OrderHandler) notifyPassengerLocationToDriver(passengerID string, lat, lng float64, heading *float64) {
	var driverUserID string
	err := h.db.QueryRow(context.Background(),
		`SELECT d.user_id
		 FROM orders o
		 JOIN drivers d ON d.id = o.driver_id
		 WHERE o.passenger_id = $1 AND o.status IN ('accepted', 'arrived', 'in_progress')
		 ORDER BY o.created_at DESC LIMIT 1`,
		passengerID,
	).Scan(&driverUserID)
	if err != nil {
		return
	}

	payload := map[string]interface{}{
		"type":         "passenger_location",
		"passenger_id": passengerID,
		"lat":          lat,
		"lng":          lng,
	}
	if heading != nil {
		payload["heading"] = *heading
	}

	msg, _ := json.Marshal(payload)
	h.hub.SendToUser(driverUserID, msg)
}

func (h *OrderHandler) notifyPassengerLocationHiddenToDriver(passengerID string) {
	var driverUserID string
	err := h.db.QueryRow(context.Background(),
		`SELECT d.user_id
		 FROM orders o
		 JOIN drivers d ON d.id = o.driver_id
		 WHERE o.passenger_id = $1 AND o.status IN ('accepted', 'arrived', 'in_progress')
		 ORDER BY o.created_at DESC LIMIT 1`,
		passengerID,
	).Scan(&driverUserID)
	if err != nil {
		return
	}

	msg, _ := json.Marshal(map[string]interface{}{
		"type":         "passenger_location_hidden",
		"passenger_id": passengerID,
	})
	h.hub.SendToUser(driverUserID, msg)
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

	// Only approved drivers can go online
	if req.Available {
		var regStatus string
		var balance float64
		var balanceExempt bool
		err := h.db.QueryRow(context.Background(),
			`SELECT COALESCE(registration_status, 'approved'), COALESCE(balance, 0), COALESCE(balance_exempt, false) FROM drivers WHERE user_id = $1`, userID,
		).Scan(&regStatus, &balance, &balanceExempt)
		if err != nil || regStatus != "approved" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Driver not approved yet"})
			return
		}
		if balance <= 0 && !balanceExempt {
			c.JSON(http.StatusForbidden, gin.H{"error": "insufficient_balance", "balance": balance})
			return
		}
	}

	h.db.Exec(context.Background(),
		`UPDATE drivers SET is_available = $1, last_seen = NOW() WHERE user_id = $2`,
		req.Available, userID,
	)
	c.JSON(http.StatusOK, gin.H{"available": req.Available})
}

// RateDriver — passenger rates the driver after a completed trip (1–5 stars).
func (h *OrderHandler) RateDriver(c *gin.Context) {
	if c.GetString("user_role") != "passenger" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only passengers can rate drivers"})
		return
	}
	orderID := c.Param("id")
	userID := c.GetString("user_id")

	var req struct {
		Rating float64 `json:"rating" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Rating < 1 || req.Rating > 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Rating must be between 1 and 5"})
		return
	}
	// Round to nearest 0.5
	rating := math.Round(req.Rating*2) / 2

	// Verify the order belongs to this passenger and is completed
	var driverID string
	err := h.db.QueryRow(context.Background(),
		`SELECT driver_id FROM orders WHERE id = $1 AND passenger_id = $2 AND status = 'completed'`,
		orderID, userID,
	).Scan(&driverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found or not completed"})
		return
	}

	// Insert rating
	_, insertErr := h.db.Exec(context.Background(),
		`INSERT INTO ratings (order_id, driver_id, passenger_id, rating)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (order_id) DO UPDATE SET rating = $4`,
		orderID, driverID, userID, rating,
	)
	if insertErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save rating"})
		return
	}

	// Recalculate driver's average rating
	h.db.Exec(context.Background(),
		`UPDATE drivers
		 SET rating_count = (SELECT COUNT(*) FROM ratings WHERE driver_id = $1),
		     average_rating = (SELECT ROUND(AVG(rating)::numeric, 2) FROM ratings WHERE driver_id = $1)
		 WHERE id = $1`,
		driverID,
	)

	c.JSON(http.StatusOK, gin.H{"message": "Rating saved", "rating": rating})
}

// GetDriverRatings — driver views their own rating history.
func (h *OrderHandler) GetDriverRatings(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Driver only"})
		return
	}
	userID := c.GetString("user_id")

	var driverID string
	if err := h.db.QueryRow(context.Background(),
		`SELECT id FROM drivers WHERE user_id = $1`, userID,
	).Scan(&driverID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT r.rating, r.created_at
		 FROM ratings r
		 WHERE r.driver_id = $1
		 ORDER BY r.created_at DESC LIMIT 100`,
		driverID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch ratings"})
		return
	}
	defer rows.Close()

	type ratingRow struct {
		Rating    float64   `json:"rating"`
		CreatedAt time.Time `json:"created_at"`
	}
	list := []ratingRow{}
	for rows.Next() {
		var r ratingRow
		rows.Scan(&r.Rating, &r.CreatedAt)
		list = append(list, r)
	}

	var avgRating float64
	var ratingCount int
	h.db.QueryRow(context.Background(),
		`SELECT COALESCE(ROUND(AVG(rating)::numeric,2),5.0), COUNT(*) FROM ratings WHERE driver_id = $1`,
		driverID,
	).Scan(&avgRating, &ratingCount)

	c.JSON(http.StatusOK, gin.H{
		"ratings":        list,
		"average_rating": avgRating,
		"rating_count":   ratingCount,
	})
}

// GET /driver/queued-orders — returns queued orders for the current driver
func (h *OrderHandler) GetQueuedOrders(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Driver only"})
		return
	}
	userID := c.GetString("user_id")

	var driverID string
	if err := h.db.QueryRow(context.Background(),
		`SELECT id FROM drivers WHERE user_id = $1`, userID,
	).Scan(&driverID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT o.id, o.pickup_lat, o.pickup_lng, COALESCE(o.pickup_address,''),
		 o.destination_lat, o.destination_lng, COALESCE(o.destination_address,''),
		 COALESCE(o.distance_km,0), COALESCE(o.total_price,0),
		 COALESCE(u.phone, o.passenger_phone,''), COALESCE(u.first_name || ' ' || u.last_name, 'Клиент'),
		 COALESCE(o.additional_info,''), COALESCE(o.trip_type,'standard'), COALESCE(o.order_type,'app'),
		 o.created_at
		 FROM orders o LEFT JOIN users u ON o.passenger_id = u.id
		 WHERE o.driver_id = $1 AND o.status = 'queued'
		 ORDER BY o.created_at ASC`,
		driverID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get queued orders"})
		return
	}
	defer rows.Close()

	var orders []map[string]interface{}
	for rows.Next() {
		var id, pickupAddr, destAddr, phone, name, info, tripType, orderType string
		var pickLat, pickLng, dist, price float64
		var destLat, destLng *float64
		var created time.Time
		rows.Scan(&id, &pickLat, &pickLng, &pickupAddr,
			&destLat, &destLng, &destAddr,
			&dist, &price, &phone, &name, &info, &tripType, &orderType, &created)
		orders = append(orders, map[string]interface{}{
			"id":                  id,
			"pickup_lat":          pickLat,
			"pickup_lng":          pickLng,
			"pickup_address":      pickupAddr,
			"destination_lat":     destLat,
			"destination_lng":     destLng,
			"destination_address": destAddr,
			"distance_km":         dist,
			"estimated_price":     price,
			"passenger_phone":     phone,
			"passenger_name":      name,
			"additional_info":     info,
			"trip_type":           tripType,
			"order_type":          orderType,
			"created_at":          created,
		})
	}

	c.JSON(http.StatusOK, gin.H{"orders": orders})
}

// GET /driver/bonus-history — returns last 50 bonus events + cashback + active settings + weekly progress
func (h *OrderHandler) GetBonusHistory(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Driver only"})
		return
	}
	userID := c.GetString("user_id")
	var driverID string
	if err := h.db.QueryRow(context.Background(),
		`SELECT id FROM drivers WHERE user_id = $1`, userID,
	).Scan(&driverID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}

	ctx := context.Background()

	rows, err := h.db.Query(ctx,
		`SELECT id, bonus_type, amount, COALESCE(description,''), created_at
		 FROM driver_bonus_events WHERE driver_id = $1
		 ORDER BY created_at DESC LIMIT 50`, driverID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	type ev struct {
		ID          string    `json:"id"`
		BonusType   string    `json:"bonus_type"`
		Amount      float64   `json:"amount"`
		Description string    `json:"description"`
		CreatedAt   time.Time `json:"created_at"`
	}
	events := []ev{}
	for rows.Next() {
		var e ev
		rows.Scan(&e.ID, &e.BonusType, &e.Amount, &e.Description, &e.CreatedAt)
		events = append(events, e)
	}

	var streakDays, lifetimeTrips int
	h.db.QueryRow(ctx,
		`SELECT COALESCE(streak_days,0), COALESCE(lifetime_trips,0) FROM drivers WHERE id = $1`, driverID,
	).Scan(&streakDays, &lifetimeTrips)

	// Active bonus settings
	var bs models.BonusSettings
	h.db.QueryRow(ctx,
		`SELECT COALESCE(night_bonus_pct,0), COALESCE(night_bonus_enabled,false),
		        COALESCE(streak_days_required,7), COALESCE(streak_bonus_amount,0), COALESCE(streak_bonus_enabled,false),
		        COALESCE(milestone_50_amount,0), COALESCE(milestone_100_amount,0),
		        COALESCE(milestone_500_amount,0), COALESCE(milestone_1000_amount,0),
		        COALESCE(milestones_enabled,false), COALESCE(weekly_bonus_enabled,false)
		 FROM bonus_settings ORDER BY id LIMIT 1`,
	).Scan(&bs.NightBonusPct, &bs.NightBonusEnabled,
		&bs.StreakDaysRequired, &bs.StreakBonusAmount, &bs.StreakBonusEnabled,
		&bs.Milestone50Amount, &bs.Milestone100Amount, &bs.Milestone500Amount, &bs.Milestone1000Amount,
		&bs.MilestonesEnabled, &bs.WeeklyBonusEnabled)

	// Referral info
	var referralBenefitType, referredBy string
	h.db.QueryRow(ctx,
		`SELECT COALESCE(referral_benefit_type,''), COALESCE(referred_by,'') FROM drivers WHERE id = $1`, driverID,
	).Scan(&referralBenefitType, &referredBy)

	// Weekly bonus progress
	type weeklyProgress struct {
		WeekNumber     int     `json:"week_number"`
		RequiredTrips  int     `json:"required_trips"`
		BonusAmount    float64 `json:"bonus_amount"`
		TripsCompleted int     `json:"trips_completed"`
		BonusPaid      bool    `json:"bonus_paid"`
		WeekStart      string  `json:"week_start"`
	}
	var wp *weeklyProgress

	if bs.WeeklyBonusEnabled {
		// Current ISO week start (Monday)
		now := time.Now().UTC()
		weekday := int(now.Weekday())
		if weekday == 0 { weekday = 7 }
		monday := now.AddDate(0, 0, -(weekday - 1)).Truncate(24 * time.Hour)
		weekStartStr := monday.Format("2006-01-02")

		var tripsCompleted int
		var bonusPaid bool
		var weekNum int
		err := h.db.QueryRow(ctx,
			`SELECT week_number, trips_completed, bonus_paid FROM driver_weekly_progress
			 WHERE driver_id = $1 AND week_start = $2`, driverID, weekStartStr,
		).Scan(&weekNum, &tripsCompleted, &bonusPaid)
		if err != nil {
			weekNum = 1
			tripsCompleted = 0
			bonusPaid = false
		}

		var reqTrips int
		var bonusAmt float64
		err = h.db.QueryRow(ctx,
			`SELECT required_trips, bonus_amount FROM weekly_bonus_tiers WHERE week_number = $1`, weekNum,
		).Scan(&reqTrips, &bonusAmt)
		if err != nil {
			reqTrips = 50
			bonusAmt = 100000
		}
		wp = &weeklyProgress{
			WeekNumber:     weekNum,
			RequiredTrips:  reqTrips,
			BonusAmount:    bonusAmt,
			TripsCompleted: tripsCompleted,
			BonusPaid:      bonusPaid,
			WeekStart:      weekStartStr,
		}
	}

	// Weekly bonus tiers
	type tier struct {
		WeekNumber    int     `json:"week_number"`
		RequiredTrips int     `json:"required_trips"`
		BonusAmount   float64 `json:"bonus_amount"`
	}
	tiers := []tier{}
	if bs.WeeklyBonusEnabled {
		tRows, _ := h.db.Query(ctx,
			`SELECT week_number, required_trips, bonus_amount FROM weekly_bonus_tiers ORDER BY week_number`)
		if tRows != nil {
			defer tRows.Close()
			for tRows.Next() {
				var t tier
				tRows.Scan(&t.WeekNumber, &t.RequiredTrips, &t.BonusAmount)
				tiers = append(tiers, t)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"events":               events,
		"streak_days":          streakDays,
		"lifetime_trips":       lifetimeTrips,
		"bonus_settings":       bs,
		"referral_benefit_type": referralBenefitType,
		"referred_by":          referredBy,
		"weekly_progress":      wp,
		"weekly_tiers":         tiers,
	})
}

// GET /driver/balance — returns driver's balance, exempt status, and recent transactions
func (h *OrderHandler) GetDriverBalance(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Driver only"})
		return
	}
	userID := c.GetString("user_id")
	var driverID string
	var balance float64
	var exempt bool
	if err := h.db.QueryRow(context.Background(),
		`SELECT id, COALESCE(balance, 0), COALESCE(balance_exempt, false) FROM drivers WHERE user_id = $1`, userID,
	).Scan(&driverID, &balance, &exempt); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}

	// Service share percentage
	var serviceSharePct float64
	h.db.QueryRow(context.Background(),
		`SELECT COALESCE(service_share_pct, 10.0) FROM price_settings ORDER BY id LIMIT 1`,
	).Scan(&serviceSharePct)

	// Last 30 transactions
	rows, err := h.db.Query(context.Background(),
		`SELECT id, amount, tx_type, COALESCE(description,''), created_at
		 FROM balance_transactions WHERE driver_id = $1
		 ORDER BY created_at DESC LIMIT 30`, driverID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type tx struct {
		ID          string    `json:"id"`
		Amount      float64   `json:"amount"`
		TxType      string    `json:"tx_type"`
		Description string    `json:"description"`
		CreatedAt   time.Time `json:"created_at"`
	}
	txs := []tx{}
	for rows.Next() {
		var t tx
		rows.Scan(&t.ID, &t.Amount, &t.TxType, &t.Description, &t.CreatedAt)
		txs = append(txs, t)
	}

	c.JSON(http.StatusOK, gin.H{
		"balance":           balance,
		"balance_exempt":    exempt,
		"service_share_pct": serviceSharePct,
		"transactions":      txs,
	})
}

// applyCompletionBonuses runs all bonus checks when a trip completes.
// It is safe to call asynchronously — all DB errors are silently logged.
func (h *OrderHandler) applyCompletionBonuses(driverID, driverUserID, orderID string, totalPrice float64, completedAt time.Time) {
	ctx := context.Background()

	// ── 1. Cashback ──────────────────────────────────────────────────────────
	var benefitType string
	var cashbackPct float64
	h.db.QueryRow(ctx, `SELECT COALESCE(referral_benefit_type,'') FROM drivers WHERE id = $1`, driverID).Scan(&benefitType)
	if benefitType == "cashback" {
		h.db.QueryRow(ctx, `SELECT COALESCE(cashback_pct,0) FROM referral_settings ORDER BY id LIMIT 1`).Scan(&cashbackPct)
		if cashbackPct > 0 {
			cashbackAmt := totalPrice * cashbackPct / 100
			h.db.Exec(ctx, `UPDATE drivers SET balance = balance + $1 WHERE id = $2`, cashbackAmt, driverID)
			h.db.Exec(ctx,
				`INSERT INTO cashback_transactions (driver_id, order_id, amount, pct) VALUES ($1, $2, $3, $4)`,
				driverID, orderID, cashbackAmt, cashbackPct)
			h.db.Exec(ctx,
				`INSERT INTO driver_bonus_events (driver_id, bonus_type, amount, description) VALUES ($1,'cashback',$2,$3)`,
				driverID, cashbackAmt, fmt.Sprintf("Кэшбэк %.0f%% — %.0f сум", cashbackPct, cashbackAmt))
			msg, _ := json.Marshal(map[string]interface{}{"type": "cashback_credited", "amount": cashbackAmt, "pct": cashbackPct})
			h.hub.SendToUser(driverUserID, msg)
		}
	}

	// ── 2. Night bonus ───────────────────────────────────────────────────────
	hour := completedAt.Hour()
	if hour >= 22 || hour < 6 {
		var nightPct float64
		var nightEnabled bool
		h.db.QueryRow(ctx, `SELECT night_bonus_pct, night_bonus_enabled FROM bonus_settings ORDER BY id LIMIT 1`).
			Scan(&nightPct, &nightEnabled)
		if nightEnabled && nightPct > 0 {
			nightAmt := totalPrice * nightPct / 100
			h.db.Exec(ctx, `UPDATE drivers SET balance = balance + $1 WHERE id = $2`, nightAmt, driverID)
			h.db.Exec(ctx,
				`INSERT INTO driver_bonus_events (driver_id, bonus_type, amount, description) VALUES ($1,'night_bonus',$2,$3)`,
				driverID, nightAmt, fmt.Sprintf("Ночная надбавка %.0f%% — %.0f сум", nightPct, nightAmt))
			msg, _ := json.Marshal(map[string]interface{}{"type": "night_bonus_credited", "amount": nightAmt})
			h.hub.SendToUser(driverUserID, msg)
		}
	}

	// ── 3. Lifetime trips + milestones ───────────────────────────────────────
	var lifetimeTrips int
	h.db.QueryRow(ctx,
		`UPDATE drivers SET lifetime_trips = COALESCE(lifetime_trips,0) + 1 WHERE id = $1 RETURNING lifetime_trips`,
		driverID).Scan(&lifetimeTrips)

	var milestonesEnabled bool
	var m50, m100, m500, m1000 float64
	h.db.QueryRow(ctx,
		`SELECT milestones_enabled, milestone_50_amount, milestone_100_amount, milestone_500_amount, milestone_1000_amount
		 FROM bonus_settings ORDER BY id LIMIT 1`,
	).Scan(&milestonesEnabled, &m50, &m100, &m500, &m1000)

	if milestonesEnabled {
		var milestoneAmt float64
		switch lifetimeTrips {
		case 50:
			milestoneAmt = m50
		case 100:
			milestoneAmt = m100
		case 500:
			milestoneAmt = m500
		case 1000:
			milestoneAmt = m1000
		}
		if milestoneAmt > 0 {
			h.db.Exec(ctx, `UPDATE drivers SET balance = balance + $1 WHERE id = $2`, milestoneAmt, driverID)
			h.db.Exec(ctx,
				`INSERT INTO driver_bonus_events (driver_id, bonus_type, amount, description) VALUES ($1,$2,$3,$4)`,
				driverID, fmt.Sprintf("milestone_%d", lifetimeTrips), milestoneAmt,
				fmt.Sprintf("🏆 Достижение %d поездок", lifetimeTrips))
			msg, _ := json.Marshal(map[string]interface{}{
				"type": "achievement_unlocked", "milestone": lifetimeTrips, "amount": milestoneAmt,
			})
			h.hub.SendToUser(driverUserID, msg)
		}
	}

	// ── 4. Streak ────────────────────────────────────────────────────────────
	var streakEnabled bool
	var streakRequired int
	var streakAmt float64
	h.db.QueryRow(ctx,
		`SELECT streak_bonus_enabled, streak_days_required, streak_bonus_amount FROM bonus_settings ORDER BY id LIMIT 1`,
	).Scan(&streakEnabled, &streakRequired, &streakAmt)

	today := completedAt.UTC().Truncate(24 * time.Hour).Format("2006-01-02")
	yesterday := completedAt.UTC().AddDate(0, 0, -1).Truncate(24 * time.Hour).Format("2006-01-02")

	var lastTripDateStr *string
	var currentStreak int
	h.db.QueryRow(ctx,
		`SELECT last_trip_date::text, COALESCE(streak_days,0) FROM drivers WHERE id = $1`, driverID,
	).Scan(&lastTripDateStr, &currentStreak)

	newStreak := currentStreak
	switch {
	case lastTripDateStr == nil:
		newStreak = 1
	case *lastTripDateStr == today:
		// already counted for today — no change
	case *lastTripDateStr == yesterday:
		newStreak = currentStreak + 1
	default:
		newStreak = 1
	}
	h.db.Exec(ctx, `UPDATE drivers SET streak_days = $1, last_trip_date = $2::date WHERE id = $3`, newStreak, today, driverID)

	if streakEnabled && streakRequired > 0 && newStreak > 0 && newStreak%streakRequired == 0 {
		h.db.Exec(ctx, `UPDATE drivers SET balance = balance + $1 WHERE id = $2`, streakAmt, driverID)
		h.db.Exec(ctx,
			`INSERT INTO driver_bonus_events (driver_id, bonus_type, amount, description) VALUES ($1,'streak',$2,$3)`,
			driverID, streakAmt, fmt.Sprintf("🔥 Стрик %d дней подряд — %.0f сум", newStreak, streakAmt))
		msg, _ := json.Marshal(map[string]interface{}{
			"type": "streak_bonus_credited", "streak_days": newStreak, "amount": streakAmt,
		})
		h.hub.SendToUser(driverUserID, msg)
	}

	// ── 5. Weekly bonus (Yandex-style progressive challenge) ─────────────────
	var weeklyBonusEnabled bool
	h.db.QueryRow(ctx, `SELECT COALESCE(weekly_bonus_enabled, false) FROM bonus_settings ORDER BY id LIMIT 1`).
		Scan(&weeklyBonusEnabled)
	if weeklyBonusEnabled {
		now := completedAt.UTC()
		weekday := int(now.Weekday())
		if weekday == 0 { weekday = 7 }
		monday := now.AddDate(0, 0, -(weekday - 1)).Truncate(24 * time.Hour)
		weekStartStr := monday.Format("2006-01-02")

		// Upsert driver weekly progress: increment trips, determine week_number
		var weekNum int
		var tripsCompleted int
		var bonusPaid bool
		err := h.db.QueryRow(ctx,
			`SELECT week_number, trips_completed, bonus_paid FROM driver_weekly_progress
			 WHERE driver_id = $1 AND week_start = $2`, driverID, weekStartStr,
		).Scan(&weekNum, &tripsCompleted, &bonusPaid)

		if err != nil {
			// First trip this week — determine week number from previous week
			var prevWeekNum int
			lastMonday := monday.AddDate(0, 0, -7).Format("2006-01-02")
			err2 := h.db.QueryRow(ctx,
				`SELECT week_number FROM driver_weekly_progress
				 WHERE driver_id = $1 AND week_start = $2 AND bonus_paid = true`,
				driverID, lastMonday,
			).Scan(&prevWeekNum)
			if err2 != nil {
				weekNum = 1 // first time or missed last week — start from week 1
			} else {
				weekNum = prevWeekNum + 1
				if weekNum > 7 { weekNum = 7 } // cap at 7
			}
			h.db.Exec(ctx,
				`INSERT INTO driver_weekly_progress (driver_id, week_start, week_number, trips_completed, bonus_paid)
				 VALUES ($1, $2::date, $3, 1, false)
				 ON CONFLICT (driver_id, week_start) DO UPDATE SET trips_completed = driver_weekly_progress.trips_completed + 1`,
				driverID, weekStartStr, weekNum)
			tripsCompleted = 1
			bonusPaid = false
		} else {
			// Already have a row — increment
			h.db.Exec(ctx,
				`UPDATE driver_weekly_progress SET trips_completed = trips_completed + 1 WHERE driver_id = $1 AND week_start = $2`,
				driverID, weekStartStr)
			tripsCompleted++
		}

		if !bonusPaid {
			var reqTrips int
			var bonusAmt float64
			h.db.QueryRow(ctx,
				`SELECT required_trips, bonus_amount FROM weekly_bonus_tiers WHERE week_number = $1`, weekNum,
			).Scan(&reqTrips, &bonusAmt)
			if reqTrips > 0 && bonusAmt > 0 && tripsCompleted >= reqTrips {
				h.db.Exec(ctx, `UPDATE drivers SET balance = balance + $1 WHERE id = $2`, bonusAmt, driverID)
				h.db.Exec(ctx,
					`UPDATE driver_weekly_progress SET bonus_paid = true WHERE driver_id = $1 AND week_start = $2`,
					driverID, weekStartStr)
				h.db.Exec(ctx,
					`INSERT INTO driver_bonus_events (driver_id, bonus_type, amount, description) VALUES ($1,'weekly_bonus',$2,$3)`,
					driverID, bonusAmt, fmt.Sprintf("🎯 Недельный бонус (неделя %d): %d поездок — %.0f сум", weekNum, reqTrips, bonusAmt))
				msg, _ := json.Marshal(map[string]interface{}{
					"type": "weekly_bonus_credited", "week_number": weekNum, "amount": bonusAmt,
				})
				h.hub.SendToUser(driverUserID, msg)
			}
		}
	}
}

// haversineMeters calculates distance in meters between two coordinates.
func haversineMeters(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000 // Earth radius in meters
	phi1 := lat1 * math.Pi / 180
	phi2 := lat2 * math.Pi / 180
	dPhi := (lat2 - lat1) * math.Pi / 180
	dLam := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dPhi/2)*math.Sin(dPhi/2) +
		math.Cos(phi1)*math.Cos(phi2)*math.Sin(dLam/2)*math.Sin(dLam/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

// ── Saved Cards (demo) ──────────────────────────────────────────────────────

// GET /driver/cards — list driver's saved cards
func (h *OrderHandler) GetDriverCards(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Driver only"})
		return
	}
	userID := c.GetString("user_id")
	var driverID string
	if err := h.db.QueryRow(context.Background(),
		`SELECT id FROM drivers WHERE user_id = $1`, userID).Scan(&driverID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}
	rows, err := h.db.Query(context.Background(),
		`SELECT id, card_number, card_holder, expiry, card_type, is_default, created_at
		 FROM driver_cards WHERE driver_id = $1 ORDER BY created_at DESC`, driverID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	type card struct {
		ID         string `json:"id"`
		Number     string `json:"card_number"`
		Holder     string `json:"card_holder"`
		Expiry     string `json:"expiry"`
		CardType   string `json:"card_type"`
		IsDefault  bool   `json:"is_default"`
		CreatedAt  string `json:"created_at"`
	}
	cards := []card{}
	for rows.Next() {
		var cd card
		var t time.Time
		rows.Scan(&cd.ID, &cd.Number, &cd.Holder, &cd.Expiry, &cd.CardType, &cd.IsDefault, &t)
		cd.CreatedAt = t.Format(time.RFC3339)
		// Mask card number for display
		if len(cd.Number) > 4 {
			cd.Number = strings.Repeat("*", len(cd.Number)-4) + cd.Number[len(cd.Number)-4:]
		}
		cards = append(cards, cd)
	}
	c.JSON(http.StatusOK, gin.H{"cards": cards})
}

// POST /driver/cards — add a new card
func (h *OrderHandler) AddDriverCard(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Driver only"})
		return
	}
	userID := c.GetString("user_id")
	var driverID string
	if err := h.db.QueryRow(context.Background(),
		`SELECT id FROM drivers WHERE user_id = $1`, userID).Scan(&driverID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}
	var body struct {
		CardNumber string `json:"card_number"`
		CardHolder string `json:"card_holder"`
		Expiry     string `json:"expiry"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	// Basic validation
	num := strings.ReplaceAll(body.CardNumber, " ", "")
	if len(num) < 13 || len(num) > 19 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid card number"})
		return
	}
	if len(body.Expiry) < 4 || len(body.Expiry) > 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid expiry (MM/YY)"})
		return
	}
	// Detect card type by prefix
	cardType := "unknown"
	if strings.HasPrefix(num, "8600") {
		cardType = "uzcard"
	} else if strings.HasPrefix(num, "9860") {
		cardType = "humo"
	} else if strings.HasPrefix(num, "4") {
		cardType = "visa"
	} else if strings.HasPrefix(num, "5") {
		cardType = "mastercard"
	}
	// Check duplicate
	var exists bool
	h.db.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM driver_cards WHERE driver_id = $1 AND card_number = $2)`,
		driverID, num).Scan(&exists)
	if exists {
		c.JSON(http.StatusConflict, gin.H{"error": "Card already added"})
		return
	}
	// If first card, make default
	var cardCount int
	h.db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM driver_cards WHERE driver_id = $1`, driverID).Scan(&cardCount)
	isDefault := cardCount == 0
	var cardID string
	err := h.db.QueryRow(context.Background(),
		`INSERT INTO driver_cards (driver_id, card_number, card_holder, expiry, card_type, is_default)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		driverID, num, body.CardHolder, body.Expiry, cardType, isDefault).Scan(&cardID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": cardID, "card_type": cardType, "is_default": isDefault})
}

// DELETE /driver/cards/:id — remove a card
func (h *OrderHandler) DeleteDriverCard(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Driver only"})
		return
	}
	userID := c.GetString("user_id")
	var driverID string
	if err := h.db.QueryRow(context.Background(),
		`SELECT id FROM drivers WHERE user_id = $1`, userID).Scan(&driverID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}
	cardID := c.Param("id")
	tag, err := h.db.Exec(context.Background(),
		`DELETE FROM driver_cards WHERE id = $1 AND driver_id = $2`, cardID, driverID)
	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Card not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// POST /driver/top-up — demo self-top-up via saved card
func (h *OrderHandler) DriverSelfTopUp(c *gin.Context) {
	if c.GetString("user_role") != "driver" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Driver only"})
		return
	}
	userID := c.GetString("user_id")
	var driverID string
	if err := h.db.QueryRow(context.Background(),
		`SELECT id FROM drivers WHERE user_id = $1`, userID).Scan(&driverID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}
	var body struct {
		Amount float64 `json:"amount"`
		CardID string  `json:"card_id"`
	}
	if err := c.BindJSON(&body); err != nil || body.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid amount"})
		return
	}
	if body.Amount < 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Minimum 1000 sum"})
		return
	}
	if body.Amount > 10000000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Maximum 10 000 000 sum"})
		return
	}
	// Verify card belongs to driver
	if body.CardID != "" {
		var cardExists bool
		h.db.QueryRow(context.Background(),
			`SELECT EXISTS(SELECT 1 FROM driver_cards WHERE id = $1 AND driver_id = $2)`,
			body.CardID, driverID).Scan(&cardExists)
		if !cardExists {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Card not found"})
			return
		}
	}
	// Demo: instantly credit balance (no real payment API)
	var newBalance float64
	err := h.db.QueryRow(context.Background(),
		`UPDATE drivers SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
		body.Amount, driverID).Scan(&newBalance)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Log transaction
	h.db.Exec(context.Background(),
		`INSERT INTO balance_transactions (driver_id, amount, tx_type, description)
		 VALUES ($1, $2, 'top_up', $3)`,
		driverID, body.Amount, "Пополнение с карты (демо)")
	// Notify via WS
	msg, _ := json.Marshal(map[string]interface{}{"type": "balance_updated", "balance": newBalance})
	h.hub.SendToUser(userID, msg)
	c.JSON(http.StatusOK, gin.H{"new_balance": newBalance})
}

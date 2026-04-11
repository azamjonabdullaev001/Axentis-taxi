package services

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type MatchingService struct {
	db   *pgxpool.Pool
	hub  *Hub
	push *PushService

	// driverLocks prevents offering the same driver to multiple orders simultaneously.
	// key = driverID, value = orderID currently being offered.
	driverLocks   map[string]string
	driverLocksMu sync.Mutex
}

func NewMatchingService(db *pgxpool.Pool, hub *Hub, push *PushService) *MatchingService {
	return &MatchingService{
		db:          db,
		hub:         hub,
		push:        push,
		driverLocks: make(map[string]string),
	}
}

type DriverCandidate struct {
	DriverID   string
	UserID     string
	Distance   float64
}

// tryLockDriver attempts to exclusively lock a driver for the given order.
// Returns true if the driver is now locked for this order, false if already locked by another.
func (s *MatchingService) tryLockDriver(driverID, orderID string) bool {
	s.driverLocksMu.Lock()
	defer s.driverLocksMu.Unlock()
	if existing, locked := s.driverLocks[driverID]; locked && existing != orderID {
		return false
	}
	s.driverLocks[driverID] = orderID
	return true
}

// unlockDriver releases the driver lock if it's held by the given order.
func (s *MatchingService) unlockDriver(driverID, orderID string) {
	s.driverLocksMu.Lock()
	defer s.driverLocksMu.Unlock()
	if s.driverLocks[driverID] == orderID {
		delete(s.driverLocks, driverID)
	}
}

// isDriverLocked checks if a driver is currently being offered an order.
func (s *MatchingService) isDriverLocked(driverID string) bool {
	s.driverLocksMu.Lock()
	defer s.driverLocksMu.Unlock()
	_, locked := s.driverLocks[driverID]
	return locked
}

// UnlockDriverForOrder is the exported version of unlockDriver, used by handlers
// to release the lock when the driver accepts/declines.
func (s *MatchingService) UnlockDriverForOrder(driverID, orderID string) {
	s.unlockDriver(driverID, orderID)
}

// FindAndNotifyDrivers implements concurrency-safe driver matching:
// 1. Find all available drivers within 5 km radius sorted by proximity
// 2. Lock and notify the closest available (unlocked) driver
// 3. If no response in 15 seconds or declined, unlock and try the next driver
// 4. Per-driver locking prevents the same driver from being offered multiple orders simultaneously
func (s *MatchingService) FindAndNotifyDrivers(orderID string, pickupLat, pickupLng float64) {
	const maxRadiusMeters = 5000.0 // 5 km hard limit
	const offerTimeout = 15 * time.Second
	log.Printf("[ORDER %s] Starting driver search: pickup=(%.6f, %.6f), radius=%.0fm", orderID, pickupLat, pickupLng, maxRadiusMeters)

	// Retry up to 6 times (30s total) — gives drivers time to go online / GPS to register
	var candidates []DriverCandidate
	var err error
	for attempt := 0; attempt < 6; attempt++ {
		if attempt > 0 {
			if s.isOrderAccepted(orderID) {
				return
			}
			// Check if order was cancelled while waiting
			var status string
			if e := s.db.QueryRow(context.Background(),
				`SELECT status FROM orders WHERE id = $1`, orderID,
			).Scan(&status); e == nil && (status == "cancelled" || status == "completed") {
				return
			}
			time.Sleep(5 * time.Second)
		}
		all, findErr := s.findNearbyDrivers(pickupLat, pickupLng)
		err = findErr
		if err == nil {
			// Filter to 5 km radius and skip drivers currently locked by other orders
			candidates = nil
			for _, c := range all {
				if c.Distance <= maxRadiusMeters && !s.isDriverLocked(c.DriverID) {
					candidates = append(candidates, c)
				}
			}
			if len(candidates) > 0 {
				break
			}
		}
		log.Printf("[ORDER %s] Attempt %d: no candidates within %.0fm (err=%v, total=%d)", orderID, attempt+1, maxRadiusMeters, err, len(candidates))
	}
	if len(candidates) == 0 {
		log.Printf("[ORDER %s] No candidates found within %.0fm after retries", orderID, maxRadiusMeters)
		s.updateOrderStatus(orderID, "cancelled")
		s.notifyPassengerNoDrivers(orderID)
		return
	}
	log.Printf("[ORDER %s] Found %d candidates within %.0fm, starting sequential notifications", orderID, len(candidates), maxRadiusMeters)

	go func() {
		for _, candidate := range candidates {
			if s.isOrderAccepted(orderID) {
				return
			}
			// Check if order was cancelled
			var status string
			if e := s.db.QueryRow(context.Background(),
				`SELECT status FROM orders WHERE id = $1`, orderID,
			).Scan(&status); e == nil && (status == "cancelled" || status == "completed") {
				return
			}

			// Try to lock the driver for this order
			if !s.tryLockDriver(candidate.DriverID, orderID) {
				log.Printf("[ORDER %s] Driver %s locked by another order, skipping", orderID, candidate.DriverID)
				continue
			}

			s.notifyDriver(candidate.UserID, orderID)
			timer := time.NewTimer(offerTimeout)
			<-timer.C

			// Unlock the driver after timeout (if order not accepted by this driver)
			s.unlockDriver(candidate.DriverID, orderID)
		}
		if !s.isOrderAccepted(orderID) {
			s.updateOrderStatus(orderID, "cancelled")
			s.notifyPassengerNoDrivers(orderID)
		}
	}()
}

// FindAndNotifyDriversInRadius — same as FindAndNotifyDrivers but only
// considers drivers within the given radius (meters) from the pickup point.
// Used for call orders to limit search to the city area.
// Uses per-driver locking to prevent conflicts with concurrent orders.
func (s *MatchingService) FindAndNotifyDriversInRadius(orderID string, pickupLat, pickupLng float64, radiusMeters float64) {
	const offerTimeout = 15 * time.Second
	log.Printf("[CALL-ORDER %s] Starting driver search: pickup=(%.6f, %.6f), radius=%.0fm",
		orderID, pickupLat, pickupLng, radiusMeters)

	all, err := s.findNearbyDrivers(pickupLat, pickupLng)
	if err != nil {
		log.Printf("[CALL-ORDER %s] findNearbyDrivers error: %v", orderID, err)
		s.updateOrderStatus(orderID, "cancelled")
		s.notifyPassengerNoDrivers(orderID)
		return
	}

	log.Printf("[CALL-ORDER %s] Total available drivers found: %d", orderID, len(all))
	for i, c := range all {
		log.Printf("[CALL-ORDER %s]   driver[%d] user=%s dist=%.0fm", orderID, i, c.UserID, c.Distance)
	}

	var candidates []DriverCandidate
	for _, c := range all {
		if c.Distance <= radiusMeters && !s.isDriverLocked(c.DriverID) {
			candidates = append(candidates, c)
		}
	}
	log.Printf("[CALL-ORDER %s] Drivers within %.0fm radius (unlocked): %d", orderID, radiusMeters, len(candidates))

	if len(candidates) == 0 {
		log.Printf("[CALL-ORDER %s] No available drivers at all — cancelling order", orderID)
		s.updateOrderStatus(orderID, "cancelled")
		s.notifyPassengerNoDrivers(orderID)
		return
	}

	go func() {
		for i, candidate := range candidates {
			if s.isOrderAccepted(orderID) {
				log.Printf("[CALL-ORDER %s] Order accepted, stopping search", orderID)
				return
			}
			// Check cancellation
			var status string
			if e := s.db.QueryRow(context.Background(),
				`SELECT status FROM orders WHERE id = $1`, orderID,
			).Scan(&status); e == nil && (status == "cancelled" || status == "completed") {
				return
			}

			if !s.tryLockDriver(candidate.DriverID, orderID) {
				log.Printf("[CALL-ORDER %s] Driver %s locked by another order, skipping", orderID, candidate.DriverID)
				continue
			}

			log.Printf("[CALL-ORDER %s] Notifying driver %d/%d: user=%s", orderID, i+1, len(candidates), candidate.UserID)
			s.notifyDriver(candidate.UserID, orderID)
			timer := time.NewTimer(offerTimeout)
			<-timer.C

			s.unlockDriver(candidate.DriverID, orderID)
		}
		if !s.isOrderAccepted(orderID) {
			log.Printf("[CALL-ORDER %s] All drivers notified, none accepted — cancelling", orderID)
			s.updateOrderStatus(orderID, "cancelled")
			s.notifyPassengerNoDrivers(orderID)
		}
	}()
}

func (s *MatchingService) findNearbyDrivers(lat, lng float64) ([]DriverCandidate, error) {
	rows, err := s.db.Query(context.Background(),
		`SELECT d.id, d.user_id, d.current_lat, d.current_lng
		 FROM drivers d
		 WHERE d.is_available = true
		   AND d.current_lat IS NOT NULL
		   AND d.current_lng IS NOT NULL
		   AND COALESCE(d.registration_status, 'approved') = 'approved'
		   AND NOT EXISTS (
		     SELECT 1 FROM orders o
		     WHERE o.driver_id = d.id
		       AND o.status IN ('queued','accepted','arrived','in_progress')
		       AND o.created_at > NOW() - INTERVAL '2 hours'
		   )`,
	)
	if err != nil {
		log.Printf("[MATCHING] findNearbyDrivers query error: %v", err)
		return nil, err
	}
	defer rows.Close()

	var candidates []DriverCandidate
	for rows.Next() {
		var driverID, userID string
		var dLat, dLng float64
		if err := rows.Scan(&driverID, &userID, &dLat, &dLng); err != nil {
			log.Printf("[MATCHING] scan error: %v", err)
			continue
		}
		dist := haversine(lat, lng, dLat, dLng)
		candidates = append(candidates, DriverCandidate{
			DriverID: driverID,
			UserID:   userID,
			Distance: dist,
		})
	}

	log.Printf("[MATCHING] findNearbyDrivers: found %d available drivers", len(candidates))
	if len(candidates) == 0 {
		// Diagnostic: log all drivers and why they don't match
		diagRows, diagErr := s.db.Query(context.Background(),
			`SELECT d.id, d.user_id, d.is_available,
			        d.current_lat IS NOT NULL AS has_lat,
			        d.current_lng IS NOT NULL AS has_lng,
			        COALESCE(d.registration_status, 'NULL') AS reg_status,
			        d.last_seen,
			        EXISTS(SELECT 1 FROM orders o WHERE o.driver_id = d.id
			               AND o.status IN ('queued','accepted','arrived','in_progress')
			               AND o.created_at > NOW() - INTERVAL '2 hours') AS has_active_order
			 FROM drivers d LIMIT 20`)
		if diagErr == nil {
			defer diagRows.Close()
			for diagRows.Next() {
				var dID, dUID, regStatus string
				var available, hasLat, hasLng, hasActiveOrder bool
				var lastSeen interface{}
				diagRows.Scan(&dID, &dUID, &available, &hasLat, &hasLng, &regStatus, &lastSeen, &hasActiveOrder)
				log.Printf("[MATCHING-DIAG] driver=%s user=%s available=%v hasLat=%v hasLng=%v regStatus=%s lastSeen=%v activeOrder=%v online=%v",
					dID, dUID, available, hasLat, hasLng, regStatus, lastSeen, hasActiveOrder, s.hub.IsOnline(dUID))
			}
		}
	}
	for i, c := range candidates {
		log.Printf("[MATCHING]   driver[%d]: id=%s user=%s dist=%.0fm online=%v",
			i, c.DriverID, c.UserID, c.Distance, s.hub.IsOnline(c.UserID))
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Distance < candidates[j].Distance
	})
	return candidates, nil
}

func (s *MatchingService) notifyDriver(userID, orderID string) {
	var orderData struct {
		ID                 string   `json:"id"`
		PickupLat          float64  `json:"pickup_lat"`
		PickupLng          float64  `json:"pickup_lng"`
		PickupAddress      string   `json:"pickup_address"`
		DestinationLat     *float64 `json:"destination_lat"`
		DestinationLng     *float64 `json:"destination_lng"`
		DestinationAddress string   `json:"destination_address"`
		DistanceKm         float64  `json:"distance_km"`
		EstimatedPrice     float64  `json:"estimated_price"`
		LockedPricePerKm   float64  `json:"locked_price_per_km"`
		SurgeMultiplier    float64  `json:"surge_multiplier"`
		PassengerPhone     string   `json:"passenger_phone"`
		PassengerName      string   `json:"passenger_name"`
		PassengerPhoto     string   `json:"passenger_photo"`
		OrderType          string   `json:"order_type"`
		TripType           string   `json:"trip_type"`
		ServiceFee         float64  `json:"service_fee"`
		AdditionalInfo     string   `json:"additional_info"`
	}

	err := s.db.QueryRow(context.Background(),
		`SELECT o.id, o.pickup_lat, o.pickup_lng, COALESCE(o.pickup_address,''), 
		 o.destination_lat, o.destination_lng, COALESCE(o.destination_address,''),
		 COALESCE(o.distance_km,0), COALESCE(o.total_price,0), COALESCE(o.locked_price_per_km,0),
		 COALESCE(o.surge_multiplier,1.0),
		 COALESCE(u.phone, o.passenger_phone, ''), COALESCE(u.first_name || ' ' || u.last_name, 'Клиент'),
		 COALESCE(u.avatar_url,''), COALESCE(o.order_type,'app'), COALESCE(o.trip_type,'standard'),
		 COALESCE(o.service_fee,2000), COALESCE(o.additional_info,'')
		 FROM orders o LEFT JOIN users u ON o.passenger_id = u.id
		 WHERE o.id = $1`, orderID,
	).Scan(&orderData.ID, &orderData.PickupLat, &orderData.PickupLng, &orderData.PickupAddress,
		&orderData.DestinationLat, &orderData.DestinationLng, &orderData.DestinationAddress,
		&orderData.DistanceKm, &orderData.EstimatedPrice, &orderData.LockedPricePerKm,
		&orderData.SurgeMultiplier,
		&orderData.PassengerPhone, &orderData.PassengerName,
		&orderData.PassengerPhoto, &orderData.OrderType, &orderData.TripType, &orderData.ServiceFee,
		&orderData.AdditionalInfo)
	if err != nil {
		log.Printf("[NOTIFY] Failed to get order data for order %s: %v", orderID, err)
		return
	}

	msg := map[string]interface{}{
		"type":  "new_order",
		"order": orderData,
	}
	data, _ := json.Marshal(msg)
	isOnline := s.hub.IsOnline(userID)
	log.Printf("[NOTIFY] Sending new_order to user %s for order %s (online=%v)", userID, orderID, isOnline)
	s.hub.SendToUser(userID, data)
	// Also send Expo push notification so the driver is alerted even if the app is killed
	go s.push.SendNewOrderPush(userID, orderData.PickupAddress, orderData.DestinationAddress, orderData.ID)
}

func (s *MatchingService) notifyPassengerNoDrivers(orderID string) {
	var passengerID *string
	err := s.db.QueryRow(context.Background(),
		`SELECT passenger_id FROM orders WHERE id = $1`, orderID,
	).Scan(&passengerID)
	if err != nil || passengerID == nil {
		return
	}
	msg, _ := json.Marshal(map[string]interface{}{
		"type":     "no_drivers",
		"order_id": orderID,
	})
	s.hub.SendToUser(*passengerID, msg)
}

func (s *MatchingService) isOrderAccepted(orderID string) bool {
	var status string
	err := s.db.QueryRow(context.Background(),
		`SELECT status FROM orders WHERE id = $1`, orderID,
	).Scan(&status)
	if err != nil {
		return false
	}
	return status == "accepted" || status == "arrived" || status == "in_progress" || status == "completed"
}

func (s *MatchingService) updateOrderStatus(orderID, status string) {
	s.db.Exec(context.Background(),
		`UPDATE orders SET status = $1 WHERE id = $2`, status, orderID,
	)
}

// haversine calculates distance in meters between two coordinates
func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000 // Earth radius in meters
	φ1 := lat1 * math.Pi / 180
	φ2 := lat2 * math.Pi / 180
	Δφ := (lat2 - lat1) * math.Pi / 180
	Δλ := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(Δφ/2)*math.Sin(Δφ/2) +
		math.Cos(φ1)*math.Cos(φ2)*math.Sin(Δλ/2)*math.Sin(Δλ/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

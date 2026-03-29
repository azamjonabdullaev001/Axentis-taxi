package services

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type MatchingService struct {
	db   *pgxpool.Pool
	hub  *Hub
	push *PushService
}

func NewMatchingService(db *pgxpool.Pool, hub *Hub, push *PushService) *MatchingService {
	return &MatchingService{db: db, hub: hub, push: push}
}

type DriverCandidate struct {
	DriverID   string
	UserID     string
	Distance   float64
}

// FindAndNotifyDrivers implements the Yandex-style driver matching algorithm:
// 1. Find all available drivers sorted by proximity
// 2. Notify the closest driver
// 3. If no response in 10 seconds or declined, try the next driver
func (s *MatchingService) FindAndNotifyDrivers(orderID string, pickupLat, pickupLng float64) {
	log.Printf("[ORDER %s] Starting driver search: pickup=(%.6f, %.6f)", orderID, pickupLat, pickupLng)
	candidates, err := s.findNearbyDrivers(pickupLat, pickupLng)
	if err != nil || len(candidates) == 0 {
		log.Printf("[ORDER %s] No candidates found (err=%v, count=%d)", orderID, err, len(candidates))
		s.notifyPassengerNoDrivers(orderID)
		return
	}
	log.Printf("[ORDER %s] Found %d candidates, starting sequential notifications", orderID, len(candidates))

	go func() {
		for _, candidate := range candidates {
			if s.isOrderAccepted(orderID) {
				return
			}
			s.notifyDriver(candidate.UserID, orderID)
			timer := time.NewTimer(10 * time.Second)
			<-timer.C
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
// Falls back to ALL available drivers if none found within the radius.
func (s *MatchingService) FindAndNotifyDriversInRadius(orderID string, pickupLat, pickupLng float64, radiusMeters float64) {
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
		if c.Distance <= radiusMeters {
			candidates = append(candidates, c)
		}
	}
	log.Printf("[CALL-ORDER %s] Drivers within %.0fm radius: %d", orderID, radiusMeters, len(candidates))

	// Fallback: if no drivers within radius, use ALL available drivers
	if len(candidates) == 0 && len(all) > 0 {
		log.Printf("[CALL-ORDER %s] No drivers in radius, falling back to all %d available drivers", orderID, len(all))
		candidates = all
	}

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
			log.Printf("[CALL-ORDER %s] Notifying driver %d/%d: user=%s", orderID, i+1, len(candidates), candidate.UserID)
			s.notifyDriver(candidate.UserID, orderID)
			timer := time.NewTimer(10 * time.Second)
			<-timer.C
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
		   AND d.last_seen > NOW() - INTERVAL '30 minutes'`,
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

	log.Printf("[MATCHING] findNearbyDrivers: found %d available drivers (last_seen < 30min)", len(candidates))
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
		 COALESCE(u.phone, o.passenger_phone, ''), COALESCE(u.first_name || ' ' || u.last_name, 'Клиент'),
		 COALESCE(u.avatar_url,''), COALESCE(o.order_type,'app'), COALESCE(o.trip_type,'standard'),
		 COALESCE(o.service_fee,2000), COALESCE(o.additional_info,'')
		 FROM orders o LEFT JOIN users u ON o.passenger_id = u.id
		 WHERE o.id = $1`, orderID,
	).Scan(&orderData.ID, &orderData.PickupLat, &orderData.PickupLng, &orderData.PickupAddress,
		&orderData.DestinationLat, &orderData.DestinationLng, &orderData.DestinationAddress,
		&orderData.DistanceKm, &orderData.EstimatedPrice, &orderData.LockedPricePerKm,
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
	log.Printf("[NOTIFY] Sending new_order to user %s for order %s", userID, orderID)
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

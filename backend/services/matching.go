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
	candidates, err := s.findNearbyDrivers(pickupLat, pickupLng)
	if err != nil || len(candidates) == 0 {
		s.notifyPassengerNoDrivers(orderID)
		return
	}

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

func (s *MatchingService) findNearbyDrivers(lat, lng float64) ([]DriverCandidate, error) {
	rows, err := s.db.Query(context.Background(),
		`SELECT d.id, d.user_id, d.current_lat, d.current_lng
		 FROM drivers d
		 WHERE d.is_available = true
		   AND d.current_lat IS NOT NULL
		   AND d.current_lng IS NOT NULL
		   AND d.last_seen > NOW() - INTERVAL '5 minutes'`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var candidates []DriverCandidate
	for rows.Next() {
		var driverID, userID string
		var dLat, dLng float64
		if err := rows.Scan(&driverID, &userID, &dLat, &dLng); err != nil {
			continue
		}
		dist := haversine(lat, lng, dLat, dLng)
		candidates = append(candidates, DriverCandidate{
			DriverID: driverID,
			UserID:   userID,
			Distance: dist,
		})
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Distance < candidates[j].Distance
	})
	return candidates, nil
}

func (s *MatchingService) notifyDriver(userID, orderID string) {
	var orderData struct {
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
		PassengerPhone     string  `json:"passenger_phone"`
		PassengerName      string  `json:"passenger_name"`
		PassengerPhoto     string  `json:"passenger_photo"`
		OrderType          string  `json:"order_type"`
		TripType           string  `json:"trip_type"`
	}

	err := s.db.QueryRow(context.Background(),
		`SELECT o.id, o.pickup_lat, o.pickup_lng, COALESCE(o.pickup_address,''), 
		 COALESCE(o.destination_lat,0), COALESCE(o.destination_lng,0), COALESCE(o.destination_address,''),
		 COALESCE(o.distance_km,0), COALESCE(o.total_price,0), COALESCE(o.locked_price_per_km,0),
		 u.phone, u.first_name || ' ' || u.last_name,
		 COALESCE(u.avatar_url,''), COALESCE(o.order_type,'app'), COALESCE(o.trip_type,'standard')
		 FROM orders o JOIN users u ON o.passenger_id = u.id
		 WHERE o.id = $1`, orderID,
	).Scan(&orderData.ID, &orderData.PickupLat, &orderData.PickupLng, &orderData.PickupAddress,
		&orderData.DestinationLat, &orderData.DestinationLng, &orderData.DestinationAddress,
		&orderData.DistanceKm, &orderData.EstimatedPrice, &orderData.LockedPricePerKm,
		&orderData.PassengerPhone, &orderData.PassengerName,
		&orderData.PassengerPhoto, &orderData.OrderType, &orderData.TripType)
	if err != nil {
		log.Printf("Failed to get order data: %v", err)
		return
	}

	msg := map[string]interface{}{
		"type":  "new_order",
		"order": orderData,
	}
	data, _ := json.Marshal(msg)
	s.hub.SendToUser(userID, data)
	// Also send Expo push notification so the driver is alerted even if the app is killed
	go s.push.SendNewOrderPush(userID, orderData.PickupAddress, orderData.DestinationAddress, orderData.ID)
}

func (s *MatchingService) notifyPassengerNoDrivers(orderID string) {
	var passengerID string
	err := s.db.QueryRow(context.Background(),
		`SELECT passenger_id FROM orders WHERE id = $1`, orderID,
	).Scan(&passengerID)
	if err != nil {
		return
	}
	msg, _ := json.Marshal(map[string]interface{}{
		"type":     "no_drivers",
		"order_id": orderID,
	})
	s.hub.SendToUser(passengerID, msg)
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

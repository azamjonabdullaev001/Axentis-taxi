package models

import "time"

type User struct {
	ID           string    `json:"id"`
	FirstName    string    `json:"first_name"`
	LastName     string    `json:"last_name"`
	Phone        string    `json:"phone"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	AvatarURL    *string   `json:"avatar_url"`
	DarkMode     bool      `json:"dark_mode"`
	Language     string    `json:"language"`
	ShareLiveLocation bool    `json:"share_live_location"`
	PushToken         *string `json:"-"`
	CurrentLat        *float64 `json:"current_lat,omitempty"`
	CurrentLng    *float64 `json:"current_lng,omitempty"`
	CurrentHeading *float64 `json:"current_heading,omitempty"`
	LastLocationAt *time.Time `json:"last_location_at,omitempty"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Driver struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	CarNumber   string     `json:"car_number"`
	IsAvailable bool       `json:"is_available"`
	CurrentLat  *float64   `json:"current_lat"`
	CurrentLng  *float64   `json:"current_lng"`
	CurrentHeading *float64 `json:"current_heading,omitempty"`
	LastSeen    time.Time  `json:"last_seen"`
	CreatedAt   time.Time  `json:"created_at"`
	User        *User      `json:"user,omitempty"`
}

type Admin struct {
	ID          string    `json:"id"`
	Phone       string    `json:"phone"`
	PasswordHash string   `json:"-"`
	AccessToken string    `json:"access_token,omitempty"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
}

type Order struct {
	ID                  string     `json:"id"`
	PassengerID         string     `json:"passenger_id"`
	DriverID            *string    `json:"driver_id"`
	Status              string     `json:"status"`
	PickupLat           float64    `json:"pickup_lat"`
	PickupLng           float64    `json:"pickup_lng"`
	PickupAddress       string     `json:"pickup_address"`
	DestinationLat      float64    `json:"destination_lat"`
	DestinationLng      float64    `json:"destination_lng"`
	DestinationAddress  string     `json:"destination_address"`
	DistanceKm          *float64   `json:"distance_km"`
	BasePrice           *float64   `json:"base_price"`
	WaitingTimeMinutes  float64    `json:"waiting_time_minutes"`
	WaitingFee          float64    `json:"waiting_fee"`
	ServiceFee          float64    `json:"service_fee"`
	TotalPrice          *float64   `json:"total_price"`
	SurgeMultiplier     float64    `json:"surge_multiplier"`
	CreatedAt           time.Time  `json:"created_at"`
	AcceptedAt          *time.Time `json:"accepted_at"`
	ArrivedAt           *time.Time `json:"arrived_at"`
	WaitStartedAt       *time.Time `json:"wait_started_at"`
	StartedAt           *time.Time `json:"started_at"`
	CompletedAt         *time.Time `json:"completed_at"`
	CancelledAt         *time.Time `json:"cancelled_at"`
	Passenger           *User      `json:"passenger,omitempty"`
	Driver              *Driver    `json:"driver,omitempty"`
}

type PriceSettings struct {
	ID                 int       `json:"id"`
	PricePerKm         float64   `json:"price_per_km"`
	PricePerMinuteWait float64   `json:"price_per_minute_wait"`
	FreeWaitMinutes    int       `json:"free_wait_minutes"`
	ServiceFee         float64   `json:"service_fee"`
	SurgeMultiplier    float64   `json:"surge_multiplier"`
	BaseSurgeMultiplier float64  `json:"base_surge_multiplier"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type SurgeSchedule struct {
	ID               string    `json:"id"`
	TargetMultiplier float64   `json:"target_multiplier"`
	StartTime        string    `json:"start_time"`
	DurationMinutes  int       `json:"duration_minutes"`
	Direction        string    `json:"direction"`
	IsActive         bool      `json:"is_active"`
	CreatedAt        time.Time `json:"created_at"`
}

type PeakPeriod struct {
	ID             string    `json:"id"`
	StartTime      string    `json:"start_time"`
	EndTime        string    `json:"end_time"`
	PeakMultiplier float64   `json:"peak_multiplier"`
	RiseMinutes    int       `json:"rise_minutes"`
	FallMinutes    int       `json:"fall_minutes"`
	IsActive       bool      `json:"is_active"`
	CreatedAt      time.Time `json:"created_at"`
}

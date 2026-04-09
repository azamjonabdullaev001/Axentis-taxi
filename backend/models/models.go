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
	ID                  string     `json:"id"`
	UserID              string     `json:"user_id"`
	CarNumber           string     `json:"car_number"`
	IsAvailable         bool       `json:"is_available"`
	CurrentLat          *float64   `json:"current_lat"`
	CurrentLng          *float64   `json:"current_lng"`
	CurrentHeading      *float64   `json:"current_heading,omitempty"`
	AverageRating       float64    `json:"average_rating"`
	RatingCount         int        `json:"rating_count"`
	LifetimeTrips       int        `json:"lifetime_trips"`
	StreakDays          int        `json:"streak_days"`
	LastSeen            time.Time  `json:"last_seen"`
	CreatedAt           time.Time  `json:"created_at"`
	User                *User      `json:"user,omitempty"`
	ReferralCode        string     `json:"referral_code,omitempty"`
	ReferredBy          string     `json:"referred_by,omitempty"`
	ReferralBenefitType string     `json:"referral_benefit_type,omitempty"`
	Balance             float64    `json:"balance"`
	RegistrationStatus  string     `json:"registration_status,omitempty"`
	ReviewedByAdminID   string     `json:"reviewed_by_admin_id,omitempty"`
	ReviewedAt          *time.Time `json:"reviewed_at,omitempty"`
	ReviewComment       string     `json:"review_comment,omitempty"`
	SelfieURL           string     `json:"selfie_url,omitempty"`
	LicenseFrontURL     string     `json:"license_front_url,omitempty"`
	LicenseBackURL      string     `json:"license_back_url,omitempty"`
	IDDocumentURL       string     `json:"id_document_url,omitempty"`
}

type ReferralSettings struct {
	ID                   int       `json:"id"`
	DefaultCommissionPct float64   `json:"default_commission_pct"`
	ReducedCommissionPct float64   `json:"reduced_commission_pct"`
	WeeklyBonusAmount    float64   `json:"weekly_bonus_amount"`
	CashbackPct          float64   `json:"cashback_pct"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// BonusSettings controls night-shift, streak, and milestone bonuses.
type BonusSettings struct {
	ID                  int       `json:"id"`
	NightBonusPct       float64   `json:"night_bonus_pct"`
	NightBonusEnabled   bool      `json:"night_bonus_enabled"`
	StreakDaysRequired  int       `json:"streak_days_required"`
	StreakBonusAmount   float64   `json:"streak_bonus_amount"`
	StreakBonusEnabled  bool      `json:"streak_bonus_enabled"`
	Milestone50Amount  float64   `json:"milestone_50_amount"`
	Milestone100Amount float64   `json:"milestone_100_amount"`
	Milestone500Amount float64   `json:"milestone_500_amount"`
	Milestone1000Amount float64  `json:"milestone_1000_amount"`
	MilestonesEnabled  bool      `json:"milestones_enabled"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// BonusEvent represents a driver_bonus_events row.
type BonusEvent struct {
	ID          string    `json:"id"`
	DriverID    string    `json:"driver_id"`
	BonusType   string    `json:"bonus_type"`
	Amount      float64   `json:"amount"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	// Enriched
	DriverName  string    `json:"driver_name,omitempty"`
	DriverPhone string    `json:"driver_phone,omitempty"`
}

// CashbackTransaction is a per-trip cashback record.
type CashbackTransaction struct {
	ID        string    `json:"id"`
	DriverID  string    `json:"driver_id"`
	OrderID   *string   `json:"order_id"`
	Amount    float64   `json:"amount"`
	Pct       float64   `json:"pct"`
	CreatedAt time.Time `json:"created_at"`
}

type ReferralBonus struct {
	ID        string    `json:"id"`
	DriverID  string    `json:"driver_id"`
	WeekStart string    `json:"week_start"`
	Amount    float64   `json:"amount"`
	PaidAt    time.Time `json:"paid_at"`
}

// DriverFriend represents a friendship row in driver_friends table.
type DriverFriend struct {
	ID          string    `json:"id"`
	RequesterID string    `json:"requester_id"`
	RecipientID string    `json:"recipient_id"`
	Status      string    `json:"status"` // pending | accepted | declined
	CreatedAt   time.Time `json:"created_at"`
}

// FriendEntry is the enriched row returned in list endpoints.
type FriendEntry struct {
	FriendshipID string  `json:"friendship_id"`
	DriverID     string  `json:"driver_id"`
	FirstName    string  `json:"first_name"`
	LastName     string  `json:"last_name"`
	Phone        string  `json:"phone"`
	AvatarURL    *string `json:"avatar_url"`
	CarNumber    string  `json:"car_number"`
}

// FriendRequest is used in the pending-requests list.
type FriendRequest struct {
	RequestID   string  `json:"request_id"`
	RequesterID string  `json:"requester_id"`
	FirstName   string  `json:"first_name"`
	LastName    string  `json:"last_name"`
	Phone       string  `json:"phone"`
	AvatarURL   *string `json:"avatar_url"`
	CarNumber   string  `json:"car_number"`
}

// DriverSearchResult is returned by the driver search endpoint.
type DriverSearchResult struct {
	DriverID  string  `json:"driver_id"`
	UserID    string  `json:"user_id"`
	FirstName string  `json:"first_name"`
	LastName  string  `json:"last_name"`
	Phone     string  `json:"phone"`
	AvatarURL *string `json:"avatar_url"`
	CarNumber string  `json:"car_number"`
}

type Rating struct {
	ID            string    `json:"id"`
	OrderID       string    `json:"order_id"`
	DriverID      string    `json:"driver_id"`
	PassengerID   string    `json:"passenger_id"`
	Rating        float64   `json:"rating"`
	PassengerName string    `json:"passenger_name,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

type Admin struct {
	ID          string    `json:"id"`
	Phone       string    `json:"phone"`
	PasswordHash string   `json:"-"`
	AccessToken string    `json:"access_token,omitempty"`
	Role        string    `json:"role"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
}

type Order struct {
	ID                  string     `json:"id"`
	PassengerID         *string    `json:"passenger_id"`
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
	TripType            string     `json:"trip_type"`
	OrderType           string     `json:"order_type"`    // "app" | "call"
	PricingType         string     `json:"pricing_type"`  // "yandex" | "royal"
	DispatcherPhone     string     `json:"dispatcher_phone"`
	PassengerPhone      string     `json:"passenger_phone"`
	RoyalPricePerKm     float64    `json:"royal_price_per_km"`
	LockedPricePerKm    float64    `json:"locked_price_per_km"`
	AdditionalInfo      string     `json:"additional_info"`
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
	ID                  int       `json:"id"`
	PricePerKm          float64   `json:"price_per_km"`
	PricePerMinuteWait  float64   `json:"price_per_minute_wait"`
	FreeWaitMinutes     int       `json:"free_wait_minutes"`
	ServiceFee          float64   `json:"service_fee"`
	SurgeMultiplier     float64   `json:"surge_multiplier"`
	BaseSurgeMultiplier float64   `json:"base_surge_multiplier"`
	RoyalPricePerKm     float64   `json:"royal_price_per_km"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type TaxiMode struct {
	Mode      string    `json:"mode"`
	UpdatedAt time.Time `json:"updated_at"`
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

type QuizScore struct {
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	OrderID        *string    `json:"order_id"`
	Score          int        `json:"score"`
	TotalQuestions int        `json:"total_questions"`
	CorrectAnswers int        `json:"correct_answers"`
	PlayedAt       time.Time  `json:"played_at"`
}

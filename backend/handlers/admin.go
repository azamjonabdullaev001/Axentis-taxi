package handlers

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/http"
	"strings"
	"time"

	"axentis-taxi/config"
	"axentis-taxi/models"
	"axentis-taxi/services"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type AdminHandler struct {
	db             *pgxpool.Pool
	cfg            *config.Config
	pricingService *services.PricingService
	hub            *services.Hub
	push           *services.PushService
	matchingService *services.MatchingService
}

func NewAdminHandler(db *pgxpool.Pool, cfg *config.Config) *AdminHandler {
	return &AdminHandler{db: db, cfg: cfg}
}

func NewAdminHandlerFull(db *pgxpool.Pool, cfg *config.Config, ps *services.PricingService, hub *services.Hub, push *services.PushService) *AdminHandler {
	return &AdminHandler{
		db:              db,
		cfg:             cfg,
		pricingService:  ps,
		hub:             hub,
		push:            push,
		matchingService: services.NewMatchingService(db, hub, push),
	}
}

type AdminLoginRequest struct {
	Phone       string `json:"phone" binding:"required"`
	Password    string `json:"password" binding:"required"`
	AccessToken string `json:"access_token"` // optional for superadmin
}

func (h *AdminHandler) Login(c *gin.Context) {
	var req AdminLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	phone := strings.TrimSpace(req.Phone)
	var admin models.Admin
	err := h.db.QueryRow(context.Background(),
		`SELECT id, phone, password_hash, access_token, is_active
		 FROM admins WHERE phone = $1`, phone,
	).Scan(&admin.ID, &admin.Phone, &admin.PasswordHash, &admin.AccessToken, &admin.IsActive)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}
	if !admin.IsActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account deactivated"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	// Superadmin (+998914751330) logs in with phone+password only — no token required.
	// All other admins must supply the 20-character access token.
	const superadminPhone = "+998914751330"
	if phone != superadminPhone {
		if req.AccessToken != admin.AccessToken {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid access token"})
			return
		}
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"admin_id": admin.ID,
		"role":     "admin",
		"exp":      time.Now().Add(8 * time.Hour).Unix(),
	})
	tokenStr, err := token.SignedString([]byte(h.cfg.JWTSecret))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Token generation failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": tokenStr, "admin_id": admin.ID})
}

func (h *AdminHandler) GetAllOrders(c *gin.Context) {
	page := 1
	limit := 50

	rows, err := h.db.Query(context.Background(),
		`SELECT o.id, o.status,
		 COALESCE(u.first_name || ' ' || u.last_name, '') as passenger_name,
		 COALESCE(u.phone, o.passenger_phone, '') as passenger_phone,
		 COALESCE(du.first_name || ' ' || du.last_name, '') as driver_name,
		 COALESCE(du.phone, '') as driver_phone,
		 COALESCE(d.car_number, '') as car_number,
		 COALESCE(o.pickup_address, '') as pickup_address,
		 COALESCE(o.destination_address, '') as destination_address,
		 COALESCE(o.distance_km, 0), COALESCE(o.base_price, 0),
		 o.waiting_fee, o.service_fee, COALESCE(o.total_price, 0),
		 o.surge_multiplier, o.created_at, o.completed_at,
		 COALESCE(o.order_type, 'app'), COALESCE(o.pricing_type, 'yandex'),
		 COALESCE(o.dispatcher_phone, '')
		 FROM orders o
		 LEFT JOIN users u ON o.passenger_id = u.id
		 LEFT JOIN drivers d ON o.driver_id = d.id
		 LEFT JOIN users du ON d.user_id = du.id
		 ORDER BY o.created_at DESC
		 LIMIT $1 OFFSET $2`,
		limit, (page-1)*limit,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch orders"})
		return
	}
	defer rows.Close()

	var orders []map[string]interface{}
	for rows.Next() {
		var id, status, passName, passPhone, driverName, driverPhone, carNum string
		var pickupAddr, destAddr string
		var distKm, basePrice, waitFee, serviceFee, totalPrice, surgeMultiplier float64
		var createdAt time.Time
		var completedAt *time.Time
		var orderType, pricingType, dispatcherPhone string

		rows.Scan(&id, &status, &passName, &passPhone, &driverName, &driverPhone, &carNum,
			&pickupAddr, &destAddr, &distKm, &basePrice, &waitFee, &serviceFee, &totalPrice,
			&surgeMultiplier, &createdAt, &completedAt, &orderType, &pricingType, &dispatcherPhone)

		orders = append(orders, map[string]interface{}{
			"id": id, "status": status,
			"passenger_name": passName, "passenger_phone": passPhone,
			"driver_name": driverName, "driver_phone": driverPhone,
			"car_number": carNum, "pickup_address": pickupAddr,
			"destination_address": destAddr, "distance_km": distKm,
			"base_price": basePrice, "waiting_fee": waitFee,
			"service_fee": serviceFee, "total_price": totalPrice,
			"surge_multiplier": surgeMultiplier,
			"created_at": createdAt, "completed_at": completedAt,
			"order_type": orderType, "pricing_type": pricingType,
			"dispatcher_phone": dispatcherPhone,
		})
	}
	if orders == nil {
		orders = []map[string]interface{}{}
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders, "count": len(orders)})
}

func (h *AdminHandler) GetRevenue(c *gin.Context) {
	var totalRevenue, totalOrders float64
	h.db.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(total_price), 0), COUNT(*)
		 FROM orders WHERE status = 'completed'`,
	).Scan(&totalRevenue, &totalOrders)

	sharePercent := 10.0
	ourShare := totalRevenue * sharePercent / 100

	// Daily revenue for last 7 days
	rows, err := h.db.Query(context.Background(),
		`SELECT DATE(completed_at)::text AS day, COALESCE(SUM(total_price), 0)
		 FROM orders
		 WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '7 days'
		 GROUP BY day ORDER BY day ASC`,
	)
	type dailyEntry struct {
		Date    string  `json:"date"`
		Revenue float64 `json:"revenue"`
	}
	daily := []dailyEntry{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var e dailyEntry
			rows.Scan(&e.Date, &e.Revenue)
			daily = append(daily, e)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"total_revenue":   totalRevenue,
		"total_orders":    totalOrders,
		"share_percent":   sharePercent,
		"our_share":       ourShare,
		"driver_earnings": totalRevenue - ourShare,
		"daily_revenue":   daily,
	})
}

func (h *AdminHandler) GetUsers(c *gin.Context) {
	role := c.Query("role")

	// For driver role, join with drivers table to include car_number, is_available, driver_id
	var rows interface{ Next() bool; Scan(...interface{}) error; Close() }
	var err error

	if role == "driver" {
		rows, err = h.db.Query(context.Background(),
			`SELECT u.id, u.first_name, u.last_name, u.phone, u.role, u.is_active, u.created_at,
			 COALESCE(d.id::text,'') as driver_id,
			 COALESCE(d.car_number,'') as car_number,
			 COALESCE(d.is_available, false) as is_available
			 FROM users u
			 LEFT JOIN drivers d ON d.user_id = u.id
			 WHERE u.role = 'driver'
			 ORDER BY u.created_at DESC LIMIT 200`,
		)
	} else if role != "" {
		rows, err = h.db.Query(context.Background(),
			`SELECT id, first_name, last_name, phone, role, is_active, created_at,
			 '', '', false FROM users WHERE role = $1 ORDER BY created_at DESC LIMIT 200`,
			role,
		)
	} else {
		rows, err = h.db.Query(context.Background(),
			`SELECT id, first_name, last_name, phone, role, is_active, created_at,
			 '', '', false FROM users ORDER BY created_at DESC LIMIT 200`,
		)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch users"})
		return
	}
	defer rows.Close()

	var users []map[string]interface{}
	for rows.Next() {
		var id, firstName, lastName, phone, userRole, driverID, carNum string
		var isActive, isAvailable bool
		var createdAt time.Time
		rows.Scan(&id, &firstName, &lastName, &phone, &userRole, &isActive, &createdAt,
			&driverID, &carNum, &isAvailable)
		u := map[string]interface{}{
			"id": id, "first_name": firstName, "last_name": lastName,
			"phone": phone, "role": userRole, "is_active": isActive, "created_at": createdAt,
		}
		if driverID != "" {
			u["driver_id"] = driverID
			u["car_number"] = carNum
			u["is_available"] = isAvailable
		}
		users = append(users, u)
	}
	if users == nil {
		users = []map[string]interface{}{}
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

func (h *AdminHandler) CreateAdmin(c *gin.Context) {
	var req struct {
		Phone       string `json:"phone" binding:"required"`
		Password    string `json:"password" binding:"required,min=8"`
		AccessToken string `json:"access_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.AccessToken) != 20 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Access token must be exactly 20 characters"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Hashing failed"})
		return
	}

	var adminID string
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO admins (phone, password_hash, access_token) VALUES ($1, $2, $3) RETURNING id`,
		req.Phone, string(hash), req.AccessToken,
	).Scan(&adminID)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			c.JSON(http.StatusConflict, gin.H{"error": "Phone already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create admin"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": adminID, "message": "Admin created"})
}

func (h *AdminHandler) GetAdmins(c *gin.Context) {
	rows, err := h.db.Query(context.Background(),
		`SELECT id, phone, is_active, created_at FROM admins ORDER BY created_at DESC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch admins"})
		return
	}
	defer rows.Close()

	var admins []map[string]interface{}
	for rows.Next() {
		var id, phone string
		var isActive bool
		var createdAt time.Time
		rows.Scan(&id, &phone, &isActive, &createdAt)
		admins = append(admins, map[string]interface{}{
			"id": id, "phone": phone, "is_active": isActive, "created_at": createdAt,
		})
	}
	if admins == nil {
		admins = []map[string]interface{}{}
	}
	c.JSON(http.StatusOK, gin.H{"admins": admins})
}

func (h *AdminHandler) GetPricingSettings(c *gin.Context) {
	var ps models.PriceSettings
	err := h.db.QueryRow(context.Background(),
		`SELECT id, price_per_km, price_per_minute_wait, free_wait_minutes,
		 service_fee, surge_multiplier, COALESCE(base_surge_multiplier, 1.0),
		 COALESCE(royal_price_per_km, 3000), updated_at
		 FROM price_settings ORDER BY id LIMIT 1`,
	).Scan(&ps.ID, &ps.PricePerKm, &ps.PricePerMinuteWait, &ps.FreeWaitMinutes,
		&ps.ServiceFee, &ps.SurgeMultiplier, &ps.BaseSurgeMultiplier,
		&ps.RoyalPricePerKm, &ps.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch pricing"})
		return
	}
	c.JSON(http.StatusOK, ps)
}

func (h *AdminHandler) UpdatePricingSettings(c *gin.Context) {
	var req struct {
		PricePerKm          *float64 `json:"price_per_km"`
		PricePerMinuteWait  *float64 `json:"price_per_minute_wait"`
		FreeWaitMinutes     *int     `json:"free_wait_minutes"`
		ServiceFee          *float64 `json:"service_fee"`
		BaseSurgeMultiplier *float64 `json:"base_surge_multiplier"`
		RoyalPricePerKm     *float64 `json:"royal_price_per_km"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate base surge bounds
	if req.BaseSurgeMultiplier != nil {
		if *req.BaseSurgeMultiplier < 0.5 || *req.BaseSurgeMultiplier > 3.5 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Base multiplier must be between 0.5 and 3.5"})
			return
		}
	}
	if req.RoyalPricePerKm != nil && *req.RoyalPricePerKm < 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Royal price per km must be at least 100 sum"})
		return
	}

	_, err := h.db.Exec(context.Background(),
		`UPDATE price_settings SET
		 price_per_km = COALESCE($1, price_per_km),
		 price_per_minute_wait = COALESCE($2, price_per_minute_wait),
		 free_wait_minutes = COALESCE($3, free_wait_minutes),
		 service_fee = COALESCE($4, service_fee),
		 base_surge_multiplier = COALESCE($5, base_surge_multiplier),
		 royal_price_per_km = COALESCE($6, royal_price_per_km),
		 updated_at = NOW()`,
		req.PricePerKm, req.PricePerMinuteWait, req.FreeWaitMinutes,
		req.ServiceFee, req.BaseSurgeMultiplier, req.RoyalPricePerKm,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update pricing"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Pricing updated"})
}

func (h *AdminHandler) GetSurgeSchedules(c *gin.Context) {
	rows, err := h.db.Query(context.Background(),
		`SELECT id, target_multiplier, start_time, duration_minutes, direction, is_active, created_at
		 FROM surge_schedules ORDER BY created_at DESC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch schedules"})
		return
	}
	defer rows.Close()

	var schedules []models.SurgeSchedule
	for rows.Next() {
		var s models.SurgeSchedule
		rows.Scan(&s.ID, &s.TargetMultiplier, &s.StartTime, &s.DurationMinutes,
			&s.Direction, &s.IsActive, &s.CreatedAt)
		schedules = append(schedules, s)
	}
	if schedules == nil {
		schedules = []models.SurgeSchedule{}
	}
	c.JSON(http.StatusOK, gin.H{"schedules": schedules})
}

func (h *AdminHandler) CreateSurgeSchedule(c *gin.Context) {
	var req struct {
		TargetMultiplier float64 `json:"target_multiplier" binding:"required"`
		StartTime        string  `json:"start_time" binding:"required"`
		DurationMinutes  int     `json:"duration_minutes" binding:"required,min=10,max=120"`
		Direction        string  `json:"direction" binding:"required,oneof=up down"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.TargetMultiplier < 0.25 || req.TargetMultiplier > 3.5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Multiplier out of range"})
		return
	}

	id := uuid.New().String()
	_, err := h.db.Exec(context.Background(),
		`INSERT INTO surge_schedules (id, target_multiplier, start_time, duration_minutes, direction)
		 VALUES ($1, $2, $3, $4, $5)`,
		id, req.TargetMultiplier, req.StartTime, req.DurationMinutes, req.Direction,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create schedule"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "message": "Schedule created"})
}

func (h *AdminHandler) DeleteSurgeSchedule(c *gin.Context) {
	id := c.Param("id")
	h.db.Exec(context.Background(),
		`UPDATE surge_schedules SET is_active = false WHERE id = $1`, id,
	)
	c.JSON(http.StatusOK, gin.H{"message": "Schedule deactivated"})
}

// ── Peak Periods ──────────────────────────────────────────────────────────────

func (h *AdminHandler) GetPeakPeriods(c *gin.Context) {
	rows, err := h.db.Query(context.Background(),
		`SELECT id, start_time::text, end_time::text, peak_multiplier,
		 rise_minutes, fall_minutes, is_active, created_at
		 FROM peak_periods WHERE is_active = true ORDER BY start_time ASC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch peak periods"})
		return
	}
	defer rows.Close()

	var periods []models.PeakPeriod
	for rows.Next() {
		var p models.PeakPeriod
		rows.Scan(&p.ID, &p.StartTime, &p.EndTime, &p.PeakMultiplier,
			&p.RiseMinutes, &p.FallMinutes, &p.IsActive, &p.CreatedAt)
		periods = append(periods, p)
	}
	if periods == nil {
		periods = []models.PeakPeriod{}
	}
	c.JSON(http.StatusOK, gin.H{"periods": periods})
}

func (h *AdminHandler) CreatePeakPeriod(c *gin.Context) {
	var req struct {
		StartTime      string  `json:"start_time" binding:"required"`
		EndTime        string  `json:"end_time" binding:"required"`
		PeakMultiplier float64 `json:"peak_multiplier" binding:"required"`
		RiseMinutes    int     `json:"rise_minutes" binding:"required,min=1"`
		FallMinutes    int     `json:"fall_minutes" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.PeakMultiplier <= 1.0 || req.PeakMultiplier > 5.0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Peak multiplier must be between 1.01 and 5.0"})
		return
	}

	// Parse times to validate window
	startT, err1 := time.Parse("15:04", req.StartTime)
	endT, err2 := time.Parse("15:04", req.EndTime)
	if err1 != nil || err2 != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid time format, use HH:MM"})
		return
	}
	windowMins := int(endT.Sub(startT).Minutes())
	if windowMins <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "End time must be after start time"})
		return
	}
	if req.RiseMinutes+req.FallMinutes >= windowMins {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Rise + fall time must be less than the total window duration"})
		return
	}

	id := uuid.New().String()
	_, err := h.db.Exec(context.Background(),
		`INSERT INTO peak_periods (id, start_time, end_time, peak_multiplier, rise_minutes, fall_minutes)
		 VALUES ($1, $2::time, $3::time, $4, $5, $6)`,
		id, req.StartTime, req.EndTime, req.PeakMultiplier, req.RiseMinutes, req.FallMinutes,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create peak period"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "message": "Peak period created"})
}

func (h *AdminHandler) DeletePeakPeriod(c *gin.Context) {
	id := c.Param("id")
	h.db.Exec(context.Background(),
		`UPDATE peak_periods SET is_active = false WHERE id = $1`, id,
	)
	c.JSON(http.StatusOK, gin.H{"message": "Peak period removed"})
}

// ── Royal Taxi Mode ───────────────────────────────────────────────────────────

func (h *AdminHandler) GetTaxiMode(c *gin.Context) {
	var tm models.TaxiMode
	err := h.db.QueryRow(context.Background(),
		`SELECT mode, updated_at FROM taxi_mode ORDER BY id LIMIT 1`,
	).Scan(&tm.Mode, &tm.UpdatedAt)
	if err != nil {
		// Return default if row missing
		c.JSON(http.StatusOK, gin.H{"mode": "yandex"})
		return
	}
	c.JSON(http.StatusOK, tm)
}

func (h *AdminHandler) SetTaxiMode(c *gin.Context) {
	var req struct {
		Mode string `json:"mode" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Mode != "yandex" && req.Mode != "royal" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be 'yandex' or 'royal'"})
		return
	}
	_, err := h.db.Exec(context.Background(),
		`UPDATE taxi_mode SET mode = $1, updated_at = NOW()`, req.Mode,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update mode"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"mode": req.Mode})
}

type CreateCallOrderRequest struct {
	PassengerPhone     string  `json:"passenger_phone" binding:"required"`
	DispatcherPhone    string  `json:"dispatcher_phone"`
	PickupLat          float64 `json:"pickup_lat" binding:"required"`
	PickupLng          float64 `json:"pickup_lng" binding:"required"`
	PickupAddress      string  `json:"pickup_address"`
	DestinationLat     float64 `json:"destination_lat"`
	DestinationLng     float64 `json:"destination_lng"`
	DestinationAddress string  `json:"destination_address"`
	DistanceKm         float64 `json:"distance_km"`
	Comment            string  `json:"comment"`
}

func (h *AdminHandler) CreateCallOrder(c *gin.Context) {
	var req CreateCallOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Store passenger phone directly on the order — no ghost user needed
	phone := strings.TrimSpace(req.PassengerPhone)

	// Lock royal price per km at time of order creation
	var royalPricePerKm float64
	if h.pricingService != nil {
		royalPricePerKm = h.pricingService.GetRoyalPricePerKm()
	} else {
		h.db.QueryRow(context.Background(),
			`SELECT COALESCE(royal_price_per_km, 3000) FROM price_settings ORDER BY id LIMIT 1`,
		).Scan(&royalPricePerKm)
		if royalPricePerKm <= 0 {
			royalPricePerKm = 3000
		}
	}

	// Get service fee from pricing settings
	var serviceFeeV float64
	var surgeV float64 = 1.0
	if h.pricingService != nil {
		ps, _ := h.pricingService.GetSettings()
		if ps != nil {
			serviceFeeV = ps.ServiceFee
			surgeV = ps.SurgeMultiplier
			if surgeV <= 0 {
				surgeV = 1.0
			}
		} else {
			serviceFeeV = 2000
		}
	} else {
		serviceFeeV = 2000
	}

	orderID := uuid.New().String()
	_, err := h.db.Exec(context.Background(),
		`INSERT INTO orders
		 (id, passenger_id, passenger_phone, status, pickup_lat, pickup_lng, pickup_address,
		  destination_lat, destination_lng, destination_address, distance_km,
		  base_price, total_price, service_fee, surge_multiplier,
		  order_type, pricing_type, trip_type, dispatcher_phone, royal_price_per_km, locked_price_per_km)
		 VALUES
		 ($1, NULL, $2, 'searching', $3, $4, $5, NULL, NULL, NULL, 0,
		  0, 0, $6, $7, 'call', 'royal', 'free', $8, $9, $9)`,
		orderID, phone,
		req.PickupLat, req.PickupLng, req.PickupAddress,
		serviceFeeV, surgeV,
		req.DispatcherPhone, royalPricePerKm,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create call order"})
		return
	}

	// Trigger driver matching in background
	if h.matchingService != nil {
		go h.matchingService.FindAndNotifyDrivers(orderID, req.PickupLat, req.PickupLng)
	}

	c.JSON(http.StatusCreated, gin.H{
		"order_id":           orderID,
		"royal_price_per_km": royalPricePerKm,
		"message":            "Call order created and driver search started",
	})
}

// ── Create Driver (admin/dispatcher creates driver account) ──────────────────

func (h *AdminHandler) CreateDriver(c *gin.Context) {
	var req struct {
		FirstName string `json:"first_name" binding:"required"`
		LastName  string `json:"last_name" binding:"required"`
		Phone     string `json:"phone" binding:"required"`
		Password  string `json:"password" binding:"required,min=8"`
		CarNumber string `json:"car_number" binding:"required"`
		PINFL     string `json:"pinfl"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	phone := strings.TrimSpace(req.Phone)
	if !strings.HasPrefix(phone, "+998") || len(strings.TrimPrefix(phone, "+")) != 12 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid Uzbekistan phone number"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Hashing failed"})
		return
	}

	tx, err := h.db.Begin(context.Background())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transaction failed"})
		return
	}
	defer tx.Rollback(context.Background())

	var userID string
	err = tx.QueryRow(context.Background(),
		`INSERT INTO users (first_name, last_name, phone, password_hash, role)
		 VALUES ($1, $2, $3, $4, 'driver') RETURNING id`,
		req.FirstName, req.LastName, phone, string(hash),
	).Scan(&userID)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			c.JSON(http.StatusConflict, gin.H{"error": "Phone number already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	// Generate unique 7-digit referral code
	refCode, err := generateReferralCodeAdmin(context.Background(), h.db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate referral code"})
		return
	}

	carNumber := strings.ToUpper(strings.TrimSpace(req.CarNumber))
	pinfl := strings.TrimSpace(req.PINFL)

	_, err = tx.Exec(context.Background(),
		`INSERT INTO drivers (user_id, car_number, pinfl, referral_code) VALUES ($1, $2, $3, $4)`,
		userID, carNumber, pinfl, refCode,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create driver profile"})
		return
	}

	if err := tx.Commit(context.Background()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit transaction"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"user_id":       userID,
		"referral_code": refCode,
		"message":       "Driver created",
	})
}

func generateReferralCodeAdmin(ctx context.Context, db *pgxpool.Pool) (string, error) {
	for i := 0; i < 20; i++ {
		b := make([]byte, 4)
		rand.Read(b)
		num := (int(b[0])<<24 | int(b[1])<<16 | int(b[2])<<8 | int(b[3])) & 0x7FFFFFFF
		code := fmt.Sprintf("%07d", num%9000000+1000000)
		var exists bool
		db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM drivers WHERE referral_code = $1)`, code).Scan(&exists)
		if !exists {
			return code, nil
		}
	}
	return "", fmt.Errorf("referral code generation failed")
}

// ── Referral Settings ─────────────────────────────────────────────────────────

func (h *AdminHandler) GetReferralSettings(c *gin.Context) {
	var rs models.ReferralSettings
	err := h.db.QueryRow(context.Background(),
		`SELECT id, default_commission_pct, reduced_commission_pct, weekly_bonus_amount, updated_at
		 FROM referral_settings ORDER BY id LIMIT 1`,
	).Scan(&rs.ID, &rs.DefaultCommissionPct, &rs.ReducedCommissionPct, &rs.WeeklyBonusAmount, &rs.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch referral settings"})
		return
	}
	c.JSON(http.StatusOK, rs)
}

func (h *AdminHandler) UpdateReferralSettings(c *gin.Context) {
	var req struct {
		DefaultCommissionPct *float64 `json:"default_commission_pct"`
		ReducedCommissionPct *float64 `json:"reduced_commission_pct"`
		WeeklyBonusAmount    *float64 `json:"weekly_bonus_amount"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.DefaultCommissionPct != nil && (*req.DefaultCommissionPct < 0 || *req.DefaultCommissionPct > 50) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "default_commission_pct must be 0–50"})
		return
	}
	if req.ReducedCommissionPct != nil && (*req.ReducedCommissionPct < 0 || *req.ReducedCommissionPct > 50) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reduced_commission_pct must be 0–50"})
		return
	}
	if req.WeeklyBonusAmount != nil && *req.WeeklyBonusAmount < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "weekly_bonus_amount must be >= 0"})
		return
	}
	_, err := h.db.Exec(context.Background(),
		`UPDATE referral_settings SET
		 default_commission_pct = COALESCE($1, default_commission_pct),
		 reduced_commission_pct = COALESCE($2, reduced_commission_pct),
		 weekly_bonus_amount    = COALESCE($3, weekly_bonus_amount),
		 updated_at = NOW()`,
		req.DefaultCommissionPct, req.ReducedCommissionPct, req.WeeklyBonusAmount,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update referral settings"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Referral settings updated"})
}

// ── Get Referrals List ────────────────────────────────────────────────────────

func (h *AdminHandler) GetReferrals(c *gin.Context) {
	rows, err := h.db.Query(context.Background(),
		`SELECT d.id, u.first_name, u.last_name, u.phone,
		 COALESCE(d.referral_code,''), COALESCE(d.referred_by,''),
		 COALESCE(d.referral_benefit_type,''), COALESCE(d.balance,0),
		 d.car_number, d.created_at
		 FROM drivers d
		 JOIN users u ON d.user_id = u.id
		 ORDER BY d.created_at DESC LIMIT 200`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch referrals"})
		return
	}
	defer rows.Close()

	var list []map[string]interface{}
	for rows.Next() {
		var id, firstName, lastName, phone, refCode, referredBy, benefitType, carNum string
		var balance float64
		var createdAt time.Time
		rows.Scan(&id, &firstName, &lastName, &phone, &refCode, &referredBy, &benefitType, &balance, &carNum, &createdAt)
		list = append(list, map[string]interface{}{
			"id": id, "first_name": firstName, "last_name": lastName, "phone": phone,
			"referral_code": refCode, "referred_by": referredBy,
			"referral_benefit_type": benefitType, "balance": balance,
			"car_number": carNum, "created_at": createdAt,
		})
	}
	if list == nil {
		list = []map[string]interface{}{}
	}
	c.JSON(http.StatusOK, gin.H{"referrals": list})
}

// ── Driver Analytics ──────────────────────────────────────────────────────────

func (h *AdminHandler) GetDriverAnalytics(c *gin.Context) {
	driverID := c.Param("id")

	// Basic driver info
	var firstName, lastName, phone, carNum, refCode, referredBy, benefitType string
	var balance float64
	var driverCreatedAt time.Time
	err := h.db.QueryRow(context.Background(),
		`SELECT u.first_name, u.last_name, u.phone, d.car_number,
		 COALESCE(d.referral_code,''), COALESCE(d.referred_by,''),
		 COALESCE(d.referral_benefit_type,''), COALESCE(d.balance,0), d.created_at
		 FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.id = $1`,
		driverID,
	).Scan(&firstName, &lastName, &phone, &carNum, &refCode, &referredBy, &benefitType, &balance, &driverCreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}

	// Fetch referral settings for commission %
	var defaultPct, reducedPct float64
	h.db.QueryRow(context.Background(),
		`SELECT default_commission_pct, reduced_commission_pct FROM referral_settings ORDER BY id LIMIT 1`,
	).Scan(&defaultPct, &reducedPct)

	commissionPct := defaultPct
	if benefitType == "commission" {
		commissionPct = reducedPct
	}

	period := c.DefaultQuery("period", "week") // day | week | month | custom
	dateFrom := c.Query("date_from")           // YYYY-MM-DD
	dateTo := c.Query("date_to")               // YYYY-MM-DD

	var interval string
	switch period {
	case "day":
		interval = "1 day"
	case "month":
		interval = "30 days"
	case "custom":
		interval = ""
	default:
		interval = "7 days"
	}

	var earningsRows interface{ Next() bool; Scan(...interface{}) error; Close() }
	if period == "custom" && dateFrom != "" && dateTo != "" {
		earningsRows, err = h.db.Query(context.Background(),
			`SELECT DATE(completed_at)::text, COALESCE(SUM(total_price), 0), COUNT(*)
			 FROM orders
			 WHERE driver_id = $1 AND status = 'completed'
			   AND completed_at >= $2::date AND completed_at < ($3::date + INTERVAL '1 day')
			 GROUP BY DATE(completed_at) ORDER BY DATE(completed_at) ASC`,
			driverID, dateFrom, dateTo,
		)
	} else {
		earningsRows, err = h.db.Query(context.Background(),
			`SELECT DATE(completed_at)::text, COALESCE(SUM(total_price), 0), COUNT(*)
			 FROM orders
			 WHERE driver_id = $1 AND status = 'completed'
			   AND completed_at >= NOW() - $2::interval
			 GROUP BY DATE(completed_at) ORDER BY DATE(completed_at) ASC`,
			driverID, interval,
		)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch earnings"})
		return
	}
	defer earningsRows.Close()

	type dailyEntry struct {
		Date    string  `json:"date"`
		Revenue float64 `json:"revenue"`
		Orders  int     `json:"orders"`
	}
	var daily []dailyEntry
	var totalRevenue float64
	var totalOrders int
	for earningsRows.Next() {
		var e dailyEntry
		earningsRows.Scan(&e.Date, &e.Revenue, &e.Orders)
		totalRevenue += e.Revenue
		totalOrders += e.Orders
		daily = append(daily, e)
	}
	if daily == nil {
		daily = []dailyEntry{}
	}

	companyShare := totalRevenue * commissionPct / 100
	driverEarnings := totalRevenue - companyShare

	// Count how many drivers this driver referred
	var referralCount int
	h.db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM drivers WHERE referred_by = $1`, refCode,
	).Scan(&referralCount)

	c.JSON(http.StatusOK, gin.H{
		"driver_id":    driverID,
		"first_name":   firstName,
		"last_name":    lastName,
		"phone":        phone,
		"car_number":   carNum,
		"referral_code":         refCode,
		"referred_by":           referredBy,
		"referral_benefit_type": benefitType,
		"commission_pct":        commissionPct,
		"balance":               balance,
		"created_at":            driverCreatedAt,
		"period":                period,
		"total_revenue":         totalRevenue,
		"total_orders":          totalOrders,
		"company_share":         companyShare,
		"driver_earnings":       driverEarnings,
		"referral_count":        referralCount,
		"daily":                 daily,
	})
}

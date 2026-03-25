package handlers

import (
	"context"
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
		 u.first_name || ' ' || u.last_name as passenger_name, u.phone as passenger_phone,
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
		 JOIN users u ON o.passenger_id = u.id
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
	query := `SELECT id, first_name, last_name, phone, role, is_active, created_at FROM users`
	args := []interface{}{}
	if role != "" {
		query += ` WHERE role = $1`
		args = append(args, role)
	}
	query += ` ORDER BY created_at DESC LIMIT 100`

	rows, err := h.db.Query(context.Background(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch users"})
		return
	}
	defer rows.Close()

	var users []map[string]interface{}
	for rows.Next() {
		var id, firstName, lastName, phone, userRole string
		var isActive bool
		var createdAt time.Time
		rows.Scan(&id, &firstName, &lastName, &phone, &userRole, &isActive, &createdAt)
		users = append(users, map[string]interface{}{
			"id": id, "first_name": firstName, "last_name": lastName,
			"phone": phone, "role": userRole, "is_active": isActive, "created_at": createdAt,
		})
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

	// Resolve or create a ghost passenger account for the phone number
	phone := strings.TrimSpace(req.PassengerPhone)
	var passengerID string
	err := h.db.QueryRow(context.Background(),
		`SELECT id FROM users WHERE phone = $1`, phone,
	).Scan(&passengerID)
	if err != nil {
		// Insert ghost user; ignore conflict if another request beat us
		ghostID := uuid.New().String()
		h.db.Exec(context.Background(),
			`INSERT INTO users (id, phone, first_name, last_name, role, is_active)
			 VALUES ($1, $2, 'Клиент', '', 'passenger', true)
			 ON CONFLICT (phone) DO NOTHING`,
			ghostID, phone,
		)
		// Always re-fetch to get the real id (inserted or pre-existing)
		if scanErr := h.db.QueryRow(context.Background(),
			`SELECT id FROM users WHERE phone = $1`, phone,
		).Scan(&passengerID); scanErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve passenger"})
			return
		}
	}

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

	// Estimate price if distance provided
	var estimatedPrice float64
	if req.DistanceKm > 0 && h.pricingService != nil {
		estimatedPrice = h.pricingService.CalculateRoyalPrice(req.DistanceKm, royalPricePerKm)
	}

	orderID := uuid.New().String()
	_, err = h.db.Exec(context.Background(),
		`INSERT INTO orders
		 (id, passenger_id, status, pickup_lat, pickup_lng, pickup_address,
		  destination_lat, destination_lng, destination_address, distance_km,
		  base_price, total_price, service_fee, surge_multiplier,
		  order_type, pricing_type, dispatcher_phone, royal_price_per_km)
		 VALUES
		 ($1, $2, 'searching', $3, $4, $5, $6, $7, $8, $9,
		  $10, $10, 0, 1.0, 'call', 'royal', $11, $12)`,
		orderID, passengerID,
		req.PickupLat, req.PickupLng, req.PickupAddress,
		req.DestinationLat, req.DestinationLng, req.DestinationAddress,
		req.DistanceKm, estimatedPrice,
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
		"order_id":          orderID,
		"passenger_id":      passengerID,
		"royal_price_per_km": royalPricePerKm,
		"estimated_price":   estimatedPrice,
		"message":           "Call order created and driver search started",
	})
}

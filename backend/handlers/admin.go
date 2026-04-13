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
		`SELECT id, phone, password_hash, access_token, is_active, COALESCE(role, 'superadmin')
		 FROM admins WHERE phone = $1`, phone,
	).Scan(&admin.ID, &admin.Phone, &admin.PasswordHash, &admin.AccessToken, &admin.IsActive, &admin.Role)
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
		"admin_id":   admin.ID,
		"role":       "admin",
		"admin_role": admin.Role,
		"exp":        time.Now().Add(8 * time.Hour).Unix(),
	})
	tokenStr, err := token.SignedString([]byte(h.cfg.JWTSecret))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Token generation failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": tokenStr, "admin_id": admin.ID, "role": admin.Role})
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
		 COALESCE(o.dispatcher_phone, ''), COALESCE(o.additional_info, '')
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
		var orderType, pricingType, dispatcherPhone, additionalInfo string

		rows.Scan(&id, &status, &passName, &passPhone, &driverName, &driverPhone, &carNum,
			&pickupAddr, &destAddr, &distKm, &basePrice, &waitFee, &serviceFee, &totalPrice,
			&surgeMultiplier, &createdAt, &completedAt, &orderType, &pricingType, &dispatcherPhone, &additionalInfo)

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
			"dispatcher_phone": dispatcherPhone, "additional_info": additionalInfo,
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

	// Read service share percentage from price_settings (set in Revenue panel)
	var sharePercent float64
	err := h.db.QueryRow(context.Background(),
		`SELECT COALESCE(service_share_pct, 10.0) FROM price_settings ORDER BY id LIMIT 1`,
	).Scan(&sharePercent)
	if err != nil || sharePercent <= 0 {
		sharePercent = 10.0
	}
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
			 COALESCE(d.is_available, false) as is_available,
			 COALESCE(u.avatar_url,'') as avatar_url,
			 COALESCE(d.registration_status, 'pending') as registration_status,
			 COALESCE(d.review_comment, '') as review_comment,
			 COALESCE(d.selfie_url, '') as selfie_url,
			 COALESCE(d.license_front_url, '') as license_front_url,
			 COALESCE(d.license_back_url, '') as license_back_url,
			 COALESCE(d.id_document_url, '') as id_document_url
			 FROM users u
			 LEFT JOIN drivers d ON d.user_id = u.id
			 WHERE u.role = 'driver'
			 ORDER BY u.created_at DESC LIMIT 200`,
		)
	} else if role != "" {
		rows, err = h.db.Query(context.Background(),
			`SELECT id, first_name, last_name, phone, role, is_active, created_at,
			 '', '', false, COALESCE(avatar_url,''), '', '', '', '', '', ''
			 FROM users WHERE role = $1 ORDER BY created_at DESC LIMIT 200`,
			role,
		)
	} else {
		rows, err = h.db.Query(context.Background(),
			`SELECT id, first_name, last_name, phone, role, is_active, created_at,
			 '', '', false, COALESCE(avatar_url,''), '', '', '', '', '', ''
			 FROM users ORDER BY created_at DESC LIMIT 200`,
		)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch users"})
		return
	}
	defer rows.Close()

	var users []map[string]interface{}
	for rows.Next() {
		var id, firstName, lastName, phone, userRole, driverID, carNum, avatarURL string
		var registrationStatus, reviewComment, selfieURL, licenseFrontURL, licenseBackURL, idDocURL string
		var isActive, isAvailable bool
		var createdAt time.Time
		rows.Scan(&id, &firstName, &lastName, &phone, &userRole, &isActive, &createdAt,
			&driverID, &carNum, &isAvailable, &avatarURL,
			&registrationStatus, &reviewComment, &selfieURL, &licenseFrontURL, &licenseBackURL, &idDocURL)
		u := map[string]interface{}{
			"id": id, "first_name": firstName, "last_name": lastName,
			"phone": phone, "role": userRole, "is_active": isActive, "created_at": createdAt,
			"avatar_url": avatarURL,
		}
		if driverID != "" {
			u["driver_id"] = driverID
			u["car_number"] = carNum
			u["is_available"] = isAvailable
			u["registration_status"] = registrationStatus
			u["review_comment"] = reviewComment
			u["selfie_url"] = selfieURL
			u["license_front_url"] = licenseFrontURL
			u["license_back_url"] = licenseBackURL
			u["id_document_url"] = idDocURL
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
		Role        string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.AccessToken) != 20 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Access token must be exactly 20 characters"})
		return
	}

	// Validate role
	validRoles := map[string]bool{
		"superadmin": true, "dispatcher": true, "orders": true,
		"revenue": true, "pricing": true, "users": true, "referrals": true,
	}
	if req.Role == "" {
		req.Role = "dispatcher"
	}
	if !validRoles[req.Role] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid role"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Hashing failed"})
		return
	}

	var adminID string
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO admins (phone, password_hash, access_token, role) VALUES ($1, $2, $3, $4) RETURNING id`,
		req.Phone, string(hash), req.AccessToken, req.Role,
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
		`SELECT id, phone, is_active, COALESCE(role, 'superadmin'), created_at FROM admins ORDER BY created_at DESC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch admins"})
		return
	}
	defer rows.Close()

	var admins []map[string]interface{}
	for rows.Next() {
		var id, phone, role string
		var isActive bool
		var createdAt time.Time
		rows.Scan(&id, &phone, &isActive, &role, &createdAt)
		admins = append(admins, map[string]interface{}{
			"id": id, "phone": phone, "is_active": isActive, "role": role, "created_at": createdAt,
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
		 COALESCE(royal_price_per_km, 3000), COALESCE(service_share_pct, 10.0), updated_at
		 FROM price_settings ORDER BY id LIMIT 1`,
	).Scan(&ps.ID, &ps.PricePerKm, &ps.PricePerMinuteWait, &ps.FreeWaitMinutes,
		&ps.ServiceFee, &ps.SurgeMultiplier, &ps.BaseSurgeMultiplier,
		&ps.RoyalPricePerKm, &ps.ServiceSharePct, &ps.UpdatedAt)
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
		ServiceSharePct     *float64 `json:"service_share_pct"`
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
	if req.ServiceSharePct != nil {
		if *req.ServiceSharePct < 0 || *req.ServiceSharePct > 50 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Service share must be between 0 and 50%"})
			return
		}
	}

	_, err := h.db.Exec(context.Background(),
		`UPDATE price_settings SET
		 price_per_km = COALESCE($1, price_per_km),
		 price_per_minute_wait = COALESCE($2, price_per_minute_wait),
		 free_wait_minutes = COALESCE($3, free_wait_minutes),
		 service_fee = COALESCE($4, service_fee),
		 base_surge_multiplier = COALESCE($5, base_surge_multiplier),
		 royal_price_per_km = COALESCE($6, royal_price_per_km),
		 service_share_pct = COALESCE($7, service_share_pct),
		 updated_at = NOW()`,
		req.PricePerKm, req.PricePerMinuteWait, req.FreeWaitMinutes,
		req.ServiceFee, req.BaseSurgeMultiplier, req.RoyalPricePerKm,
		req.ServiceSharePct,
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

// ── Hourly Surge (Yandex-style) ───────────────────────────────────────────────

func (h *AdminHandler) GetHourlySurge(c *gin.Context) {
	rows, err := h.db.Query(context.Background(),
		`SELECT hour, multiplier FROM hourly_surge ORDER BY hour ASC`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch hourly surge"})
		return
	}
	defer rows.Close()

	var hours []models.HourlySurge
	for rows.Next() {
		var h models.HourlySurge
		rows.Scan(&h.Hour, &h.Multiplier)
		hours = append(hours, h)
	}
	if hours == nil {
		hours = []models.HourlySurge{}
	}
	c.JSON(http.StatusOK, gin.H{"hours": hours})
}

func (h *AdminHandler) UpdateHourlySurge(c *gin.Context) {
	var req struct {
		Hours []models.HourlySurge `json:"hours" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for _, hs := range req.Hours {
		if hs.Hour < 0 || hs.Hour > 23 {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid hour: %d", hs.Hour)})
			return
		}
		if hs.Multiplier < 0.5 || hs.Multiplier > 5.0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Multiplier for hour %d must be between 0.5 and 5.0", hs.Hour)})
			return
		}
	}

	for _, hs := range req.Hours {
		_, err := h.db.Exec(context.Background(),
			`INSERT INTO hourly_surge (hour, multiplier) VALUES ($1, $2)
			 ON CONFLICT (hour) DO UPDATE SET multiplier = $2`,
			hs.Hour, hs.Multiplier,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update hourly surge"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "Hourly surge updated"})
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
	AdditionalInfo     string  `json:"additional_info"`
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
		  order_type, pricing_type, trip_type, dispatcher_phone, royal_price_per_km, locked_price_per_km, additional_info)
		 VALUES
		 ($1, NULL, $2, 'searching', $3, $4, $5, NULL, NULL, NULL, 0,
		  0, 0, $6, $7, 'call', 'royal', 'free', $8, $9, $9, $10)`,
		orderID, phone,
		req.PickupLat, req.PickupLng, req.PickupAddress,
		serviceFeeV, surgeV,
		req.DispatcherPhone, royalPricePerKm, req.AdditionalInfo,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create call order"})
		return
	}

	// Trigger driver matching in background — search only within city radius for call orders
	if h.matchingService != nil {
		go h.matchingService.FindAndNotifyDriversInRadius(orderID, req.PickupLat, req.PickupLng, 15000)
	}

	c.JSON(http.StatusCreated, gin.H{
		"order_id":           orderID,
		"royal_price_per_km": royalPricePerKm,
		"message":            "Call order created and driver search started",
	})
}

// ── Create Driver (admin/dispatcher creates driver account) ──────────────────

func (h *AdminHandler) CreateDriver(c *gin.Context) {
	var firstName, lastName, phone, password, carNumber, carBrand string
	var selfieURL, licenseFrontURL, licenseBackURL, idDocumentURL, idDocumentBackURL string

	if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		firstName = strings.TrimSpace(c.PostForm("first_name"))
		lastName = strings.TrimSpace(c.PostForm("last_name"))
		phone = strings.TrimSpace(c.PostForm("phone"))
		password = c.PostForm("password")
		carNumber = strings.TrimSpace(c.PostForm("car_number"))
		carBrand = strings.TrimSpace(c.PostForm("car_brand"))

		if firstName == "" || lastName == "" || phone == "" || password == "" || carNumber == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "All required fields must be filled"})
			return
		}
		if len(password) < 8 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Password must be at least 8 characters"})
			return
		}

		// Optional photo uploads
		if f, err := c.FormFile("selfie"); err == nil {
			selfieURL, _ = saveUploadedImage(f, "driver-docs")
		}
		if f, err := c.FormFile("license_front"); err == nil {
			licenseFrontURL, _ = saveUploadedImage(f, "driver-docs")
		}
		if f, err := c.FormFile("license_back"); err == nil {
			licenseBackURL, _ = saveUploadedImage(f, "driver-docs")
		}
		if f, err := c.FormFile("id_document"); err == nil {
			idDocumentURL, _ = saveUploadedImage(f, "driver-docs")
		}
		if f, err := c.FormFile("id_document_back"); err == nil {
			idDocumentBackURL, _ = saveUploadedImage(f, "driver-docs")
		}
	} else {
		var req struct {
			FirstName string `json:"first_name" binding:"required"`
			LastName  string `json:"last_name" binding:"required"`
			Phone     string `json:"phone" binding:"required"`
			Password  string `json:"password" binding:"required,min=8"`
			CarNumber string `json:"car_number" binding:"required"`
			CarBrand  string `json:"car_brand"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		firstName = req.FirstName
		lastName = req.LastName
		phone = strings.TrimSpace(req.Phone)
		password = req.Password
		carNumber = req.CarNumber
		carBrand = req.CarBrand
	}

	if !strings.HasPrefix(phone, "+998") || len(strings.TrimPrefix(phone, "+")) != 12 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid Uzbekistan phone number"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
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
		firstName, lastName, phone, string(hash),
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

	normalizedCarNumber := strings.ToUpper(strings.TrimSpace(carNumber))

	_, err = tx.Exec(context.Background(),
		`INSERT INTO drivers (user_id, car_number, car_brand, referral_code, registration_status, reviewed_at,
		  selfie_url, license_front_url, license_back_url, id_document_url, id_document_back_url)
		 VALUES ($1, $2, $3, $4, 'approved', NOW(), $5, $6, $7, $8, $9)`,
		userID, normalizedCarNumber, carBrand, refCode,
		selfieURL, licenseFrontURL, licenseBackURL, idDocumentURL, idDocumentBackURL,
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

// ── Driver Registration Moderation ──────────────────────────────────────────

func (h *AdminHandler) GetPendingDriverRegistrations(c *gin.Context) {
	rows, err := h.db.Query(context.Background(),
		`SELECT d.id, d.user_id, u.first_name, u.last_name, u.phone,
		        d.car_number, COALESCE(d.car_brand, ''), d.created_at,
		        COALESCE(d.selfie_url, ''), COALESCE(d.license_front_url, ''),
		        COALESCE(d.license_back_url, ''), COALESCE(d.id_document_url, ''),
		        COALESCE(d.id_document_back_url, ''),
		        COALESCE(d.registration_status, 'pending'), COALESCE(d.review_comment, '')
		 FROM drivers d
		 JOIN users u ON d.user_id = u.id
		 WHERE COALESCE(d.registration_status, 'pending') = 'pending'
		 ORDER BY d.created_at ASC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch pending registrations"})
		return
	}
	defer rows.Close()

	var items []map[string]interface{}
	for rows.Next() {
		var driverID, userID, firstName, lastName, phone, carNumber, carBrand string
		var selfieURL, licenseFrontURL, licenseBackURL, idDocURL, idDocBackURL, status, reviewComment string
		var createdAt time.Time
		if err := rows.Scan(
			&driverID, &userID, &firstName, &lastName, &phone,
			&carNumber, &carBrand, &createdAt,
			&selfieURL, &licenseFrontURL, &licenseBackURL, &idDocURL, &idDocBackURL,
			&status, &reviewComment,
		); err != nil {
			continue
		}

		items = append(items, map[string]interface{}{
			"driver_id":            driverID,
			"user_id":              userID,
			"first_name":           firstName,
			"last_name":            lastName,
			"phone":                phone,
			"car_number":           carNumber,
			"car_brand":            carBrand,
			"created_at":           createdAt,
			"registration_status":  status,
			"review_comment":       reviewComment,
			"selfie_url":           selfieURL,
			"license_front_url":    licenseFrontURL,
			"license_back_url":     licenseBackURL,
			"id_document_url":      idDocURL,
			"id_document_back_url": idDocBackURL,
		})
	}
	if items == nil {
		items = []map[string]interface{}{}
	}
	c.JSON(http.StatusOK, gin.H{"drivers": items})
}

func (h *AdminHandler) ApproveDriverRegistration(c *gin.Context) {
	driverID := c.Param("id")
	adminID := c.GetString("admin_id")
	var req struct {
		Comment string `json:"comment"`
	}
	_ = c.ShouldBindJSON(&req)

	ct, err := h.db.Exec(context.Background(),
		`UPDATE drivers
		 SET registration_status = 'approved',
		     reviewed_by_admin_id = $2,
		     reviewed_at = NOW(),
		     review_comment = COALESCE(NULLIF($3,''), review_comment)
		 WHERE id = $1`,
		driverID, adminID, strings.TrimSpace(req.Comment),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to approve driver"})
		return
	}
	if ct.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}

	_, _ = h.db.Exec(context.Background(),
		`UPDATE users SET is_active = true, updated_at = NOW()
		 WHERE id = (SELECT user_id FROM drivers WHERE id = $1)`,
		driverID,
	)

	c.JSON(http.StatusOK, gin.H{"message": "Driver registration approved"})
}

func (h *AdminHandler) RejectDriverRegistration(c *gin.Context) {
	driverID := c.Param("id")
	adminID := c.GetString("admin_id")
	var req struct {
		Comment string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Rejection comment is required"})
		return
	}
	comment := strings.TrimSpace(req.Comment)
	if comment == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Rejection comment is required"})
		return
	}

	ct, err := h.db.Exec(context.Background(),
		`UPDATE drivers
		 SET registration_status = 'rejected',
		     reviewed_by_admin_id = $2,
		     reviewed_at = NOW(),
		     review_comment = $3,
		     is_available = false
		 WHERE id = $1`,
		driverID, adminID, comment,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reject driver"})
		return
	}
	if ct.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Driver registration rejected"})
}

// ── Ban / Unban / Delete User ─────────────────────────────────────────────────

func (h *AdminHandler) BanUser(c *gin.Context) {
	userID := c.Param("id")
	var req struct {
		Duration string `json:"duration"` // "1h", "24h", "7d", "30d", "forever"
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var bannedUntil time.Time
	switch req.Duration {
	case "1h":
		bannedUntil = time.Now().Add(1 * time.Hour)
	case "24h":
		bannedUntil = time.Now().Add(24 * time.Hour)
	case "7d":
		bannedUntil = time.Now().Add(7 * 24 * time.Hour)
	case "30d":
		bannedUntil = time.Now().Add(30 * 24 * time.Hour)
	case "forever":
		bannedUntil = time.Now().Add(100 * 365 * 24 * time.Hour) // ~100 years
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid duration. Use: 1h, 24h, 7d, 30d, forever"})
		return
	}

	ct, err := h.db.Exec(context.Background(),
		`UPDATE users SET banned_until = $1, ban_reason = $2, is_active = false WHERE id = $3`,
		bannedUntil, req.Reason, userID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// If driver — also set offline
	h.db.Exec(context.Background(),
		`UPDATE drivers SET is_available = false WHERE user_id = $1`, userID)

	c.JSON(http.StatusOK, gin.H{"message": "User banned", "banned_until": bannedUntil})
}

func (h *AdminHandler) UnbanUser(c *gin.Context) {
	userID := c.Param("id")
	ct, err := h.db.Exec(context.Background(),
		`UPDATE users SET banned_until = NULL, ban_reason = '', is_active = true WHERE id = $1`,
		userID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "User unbanned"})
}

func (h *AdminHandler) DeleteUser(c *gin.Context) {
	userID := c.Param("id")

	// Delete cascade: orders, ratings, driver profile, then user
	tx, err := h.db.Begin(context.Background())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transaction failed"})
		return
	}
	defer tx.Rollback(context.Background())

	// Delete related records
	tx.Exec(context.Background(), `DELETE FROM quiz_scores WHERE user_id = $1`, userID)
	tx.Exec(context.Background(), `DELETE FROM ratings WHERE passenger_id = $1`, userID)
	tx.Exec(context.Background(),
		`DELETE FROM orders WHERE passenger_id = $1 OR driver_id IN (SELECT id FROM drivers WHERE user_id = $1)`, userID)
	tx.Exec(context.Background(),
		`DELETE FROM cashback_transactions WHERE driver_id IN (SELECT id FROM drivers WHERE user_id = $1)`, userID)
	tx.Exec(context.Background(),
		`DELETE FROM driver_bonus_events WHERE driver_id IN (SELECT id FROM drivers WHERE user_id = $1)`, userID)
	tx.Exec(context.Background(),
		`DELETE FROM referral_bonuses WHERE driver_id IN (SELECT id FROM drivers WHERE user_id = $1)`, userID)
	tx.Exec(context.Background(),
		`DELETE FROM driver_friends WHERE requester_id IN (SELECT id FROM drivers WHERE user_id = $1) OR recipient_id IN (SELECT id FROM drivers WHERE user_id = $1)`, userID)
	tx.Exec(context.Background(),
		`DELETE FROM ratings WHERE driver_id IN (SELECT id FROM drivers WHERE user_id = $1)`, userID)
	tx.Exec(context.Background(), `DELETE FROM drivers WHERE user_id = $1`, userID)
	tx.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)

	if err := tx.Commit(context.Background()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Delete failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "User deleted"})
}

// ── Referral Settings ─────────────────────────────────────────────────────────

func (h *AdminHandler) GetReferralSettings(c *gin.Context) {
	var rs models.ReferralSettings
	err := h.db.QueryRow(context.Background(),
		`SELECT id, default_commission_pct, reduced_commission_pct, weekly_bonus_amount,
		 COALESCE(cashback_pct,10.0), updated_at
		 FROM referral_settings ORDER BY id LIMIT 1`,
	).Scan(&rs.ID, &rs.DefaultCommissionPct, &rs.ReducedCommissionPct, &rs.WeeklyBonusAmount, &rs.CashbackPct, &rs.UpdatedAt)
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
		CashbackPct          *float64 `json:"cashback_pct"`
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
	if req.CashbackPct != nil && (*req.CashbackPct < 0 || *req.CashbackPct > 50) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cashback_pct must be 0–50"})
		return
	}
	_, err := h.db.Exec(context.Background(),
		`UPDATE referral_settings SET
		 default_commission_pct = COALESCE($1, default_commission_pct),
		 reduced_commission_pct = COALESCE($2, reduced_commission_pct),
		 weekly_bonus_amount    = COALESCE($3, weekly_bonus_amount),
		 cashback_pct           = COALESCE($4, cashback_pct),
		 updated_at = NOW()`,
		req.DefaultCommissionPct, req.ReducedCommissionPct, req.WeeklyBonusAmount, req.CashbackPct,
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
	var firstName, lastName, phone, carNum, refCode, referredBy, benefitType, avatarURL string
	var balance float64
	var driverCreatedAt time.Time
	err := h.db.QueryRow(context.Background(),
		`SELECT u.first_name, u.last_name, u.phone, d.car_number,
		 COALESCE(d.referral_code,''), COALESCE(d.referred_by,''),
		 COALESCE(d.referral_benefit_type,''), COALESCE(d.balance,0), d.created_at,
		 COALESCE(u.avatar_url,'')
		 FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.id = $1`,
		driverID,
	).Scan(&firstName, &lastName, &phone, &carNum, &refCode, &referredBy, &benefitType, &balance, &driverCreatedAt, &avatarURL)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}

	// Fetch commission % from price_settings (set in admin Pricing/Revenue panel)
	var commissionPct float64
	err = h.db.QueryRow(context.Background(),
		`SELECT COALESCE(service_share_pct, 10.0) FROM price_settings ORDER BY id LIMIT 1`,
	).Scan(&commissionPct)
	if err != nil || commissionPct <= 0 {
		commissionPct = 10.0
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
		Date       string  `json:"date"`
		Revenue    float64 `json:"revenue"`
		Orders     int     `json:"orders"`
		Commission float64 `json:"commission"`
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

	// Actual per-order commission from balance_transactions (locked at completion time)
	var companyShare float64
	if period == "custom" && dateFrom != "" && dateTo != "" {
		h.db.QueryRow(context.Background(),
			`SELECT COALESCE(ABS(SUM(amount)), 0)
			 FROM balance_transactions
			 WHERE driver_id = $1 AND tx_type = 'commission'
			   AND created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day')`,
			driverID, dateFrom, dateTo,
		).Scan(&companyShare)
	} else {
		h.db.QueryRow(context.Background(),
			`SELECT COALESCE(ABS(SUM(amount)), 0)
			 FROM balance_transactions
			 WHERE driver_id = $1 AND tx_type = 'commission'
			   AND created_at >= NOW() - $2::interval`,
			driverID, interval,
		).Scan(&companyShare)
	}

	// Per-day actual commission for daily breakdown
	dailyCommMap := map[string]float64{}
	var commRows interface{ Next() bool; Scan(...interface{}) error; Close() }
	if period == "custom" && dateFrom != "" && dateTo != "" {
		commRows, err = h.db.Query(context.Background(),
			`SELECT DATE(created_at)::text, COALESCE(ABS(SUM(amount)), 0)
			 FROM balance_transactions
			 WHERE driver_id = $1 AND tx_type = 'commission'
			   AND created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day')
			 GROUP BY DATE(created_at)`,
			driverID, dateFrom, dateTo,
		)
	} else {
		commRows, err = h.db.Query(context.Background(),
			`SELECT DATE(created_at)::text, COALESCE(ABS(SUM(amount)), 0)
			 FROM balance_transactions
			 WHERE driver_id = $1 AND tx_type = 'commission'
			   AND created_at >= NOW() - $2::interval
			 GROUP BY DATE(created_at)`,
			driverID, interval,
		)
	}
	if err == nil {
		defer commRows.Close()
		for commRows.Next() {
			var dt string
			var amt float64
			commRows.Scan(&dt, &amt)
			dailyCommMap[dt] = amt
		}
	}
	for i := range daily {
		daily[i].Commission = dailyCommMap[daily[i].Date]
	}

	driverEarnings := totalRevenue - companyShare

	// Total company earnings from this driver (all-time)
	var totalCompanyEarnings float64
	h.db.QueryRow(context.Background(),
		`SELECT COALESCE(ABS(SUM(amount)), 0)
		 FROM balance_transactions
		 WHERE driver_id = $1 AND tx_type = 'commission'`,
		driverID,
	).Scan(&totalCompanyEarnings)

	// Count how many drivers this driver referred
	var referralCount int
	h.db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM drivers WHERE referred_by = $1`, refCode,
	).Scan(&referralCount)

	// lifetime_trips for progress display
	var lifetimeTrips int
	h.db.QueryRow(context.Background(),
		`SELECT COALESCE(lifetime_trips, 0) FROM drivers WHERE id = $1`, driverID,
	).Scan(&lifetimeTrips)

	c.JSON(http.StatusOK, gin.H{
		"driver_id":    driverID,
		"first_name":   firstName,
		"last_name":    lastName,
		"phone":        phone,
		"car_number":   carNum,
		"avatar_url":            avatarURL,
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
		"total_company_earnings": totalCompanyEarnings,
		"referral_count":        referralCount,
		"lifetime_trips":        lifetimeTrips,
		"daily":                 daily,
	})
}

// ── Get Online Drivers (for dispatcher map) ─────────────────────────────────

func (h *AdminHandler) GetOnlineDrivers(c *gin.Context) {
	rows, err := h.db.Query(context.Background(),
		`SELECT d.id, d.user_id, u.first_name, u.last_name, u.phone, COALESCE(u.avatar_url,''),
		        d.car_number, d.is_available, d.current_lat, d.current_lng,
		        COALESCE(d.current_heading, 0), d.last_seen
		 FROM drivers d
		 JOIN users u ON d.user_id = u.id
		 WHERE d.current_lat IS NOT NULL
		   AND d.current_lng IS NOT NULL
		   AND d.last_seen > NOW() - INTERVAL '1 hour'
		 ORDER BY d.last_seen DESC`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch drivers"})
		return
	}
	defer rows.Close()

	type OnlineDriver struct {
		DriverID     string   `json:"driver_id"`
		UserID       string   `json:"user_id"`
		FirstName    string   `json:"first_name"`
		LastName     string   `json:"last_name"`
		Phone        string   `json:"phone"`
		AvatarURL    string   `json:"avatar_url"`
		CarNumber    string   `json:"car_number"`
		IsAvailable  bool     `json:"is_available"`
		Lat          float64  `json:"lat"`
		Lng          float64  `json:"lng"`
		Heading      float64  `json:"heading"`
		LastSeen     string   `json:"last_seen"`
		// Active order info (filled below)
		HasOrder          bool    `json:"has_order"`
		OrderID           string  `json:"order_id,omitempty"`
		OrderStatus       string  `json:"order_status,omitempty"`
		PassengerPhone    string  `json:"passenger_phone,omitempty"`
		PickupLat         float64 `json:"pickup_lat,omitempty"`
		PickupLng         float64 `json:"pickup_lng,omitempty"`
		PickupAddress     string  `json:"pickup_address,omitempty"`
		DestinationLat    float64 `json:"destination_lat,omitempty"`
		DestinationLng    float64 `json:"destination_lng,omitempty"`
		DestinationAddress string `json:"destination_address,omitempty"`
	}

	var drivers []OnlineDriver
	for rows.Next() {
		var d OnlineDriver
		var lastSeen time.Time
		if err := rows.Scan(&d.DriverID, &d.UserID, &d.FirstName, &d.LastName, &d.Phone,
			&d.AvatarURL, &d.CarNumber, &d.IsAvailable, &d.Lat, &d.Lng, &d.Heading, &lastSeen); err != nil {
			continue
		}
		d.LastSeen = lastSeen.Format(time.RFC3339)
		drivers = append(drivers, d)
	}

	// Fetch active orders for all online drivers in one query
	orderRows, err := h.db.Query(context.Background(),
		`SELECT d.id, o.id, o.status,
		        COALESCE(u.phone, o.passenger_phone, ''),
		        o.pickup_lat, o.pickup_lng, COALESCE(o.pickup_address,''),
		        COALESCE(o.destination_lat,0), COALESCE(o.destination_lng,0), COALESCE(o.destination_address,'')
		 FROM orders o
		 JOIN drivers d ON o.driver_id = d.id
		 LEFT JOIN users u ON o.passenger_id = u.id
		 WHERE o.status IN ('accepted', 'arrived', 'in_progress')`)
	if err == nil {
		defer orderRows.Close()
		orderMap := make(map[string]OnlineDriver)
		for orderRows.Next() {
			var driverID, orderID, status, passPhone, pickAddr, destAddr string
			var pickLat, pickLng, destLat, destLng float64
			if err := orderRows.Scan(&driverID, &orderID, &status, &passPhone,
				&pickLat, &pickLng, &pickAddr, &destLat, &destLng, &destAddr); err != nil {
				continue
			}
			orderMap[driverID] = OnlineDriver{
				HasOrder:           true,
				OrderID:            orderID,
				OrderStatus:        status,
				PassengerPhone:     passPhone,
				PickupLat:          pickLat,
				PickupLng:          pickLng,
				PickupAddress:      pickAddr,
				DestinationLat:     destLat,
				DestinationLng:     destLng,
				DestinationAddress: destAddr,
			}
		}
		for i, d := range drivers {
			if info, ok := orderMap[d.DriverID]; ok {
				drivers[i].HasOrder = true
				drivers[i].OrderID = info.OrderID
				drivers[i].OrderStatus = info.OrderStatus
				drivers[i].PassengerPhone = info.PassengerPhone
				drivers[i].PickupLat = info.PickupLat
				drivers[i].PickupLng = info.PickupLng
				drivers[i].PickupAddress = info.PickupAddress
				drivers[i].DestinationLat = info.DestinationLat
				drivers[i].DestinationLng = info.DestinationLng
				drivers[i].DestinationAddress = info.DestinationAddress
			}
		}
	}

	if drivers == nil {
		drivers = []OnlineDriver{}
	}
	c.JSON(http.StatusOK, gin.H{"drivers": drivers})
}

// ── Phone address history (last used addresses by phone number) ─────────────

func (h *AdminHandler) GetPhoneHistory(c *gin.Context) {
	phone := strings.TrimSpace(c.Query("phone"))
	if phone == "" {
		c.JSON(http.StatusOK, gin.H{"addresses": []string{}})
		return
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT DISTINCT ON (pickup_address) pickup_address, pickup_lat, pickup_lng, created_at
		 FROM orders
		 WHERE (passenger_phone = $1 OR passenger_phone = $2)
		   AND pickup_address IS NOT NULL AND pickup_address != ''
		 ORDER BY pickup_address, created_at DESC`,
		phone, strings.TrimPrefix(phone, "+"),
	)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"addresses": []string{}})
		return
	}
	defer rows.Close()

	type AddrHistory struct {
		Address string  `json:"address"`
		Lat     float64 `json:"lat"`
		Lng     float64 `json:"lng"`
	}
	var addresses []AddrHistory
	for rows.Next() {
		var addr string
		var lat, lng float64
		var t time.Time
		if err := rows.Scan(&addr, &lat, &lng, &t); err != nil {
			continue
		}
		addresses = append(addresses, AddrHistory{Address: addr, Lat: lat, Lng: lng})
	}
	if addresses == nil {
		addresses = []AddrHistory{}
	}
	c.JSON(http.StatusOK, gin.H{"addresses": addresses})
}

// ── Bonus Settings ────────────────────────────────────────────────────────────

func (h *AdminHandler) GetBonusSettings(c *gin.Context) {
	var bs models.BonusSettings
	err := h.db.QueryRow(context.Background(),
		`SELECT id, night_bonus_pct, night_bonus_enabled,
		        streak_days_required, streak_bonus_amount, streak_bonus_enabled,
		        milestone_50_amount, milestone_100_amount, milestone_500_amount, milestone_1000_amount,
		        milestones_enabled, COALESCE(weekly_bonus_enabled, false), updated_at
		 FROM bonus_settings ORDER BY id LIMIT 1`,
	).Scan(&bs.ID, &bs.NightBonusPct, &bs.NightBonusEnabled,
		&bs.StreakDaysRequired, &bs.StreakBonusAmount, &bs.StreakBonusEnabled,
		&bs.Milestone50Amount, &bs.Milestone100Amount, &bs.Milestone500Amount, &bs.Milestone1000Amount,
		&bs.MilestonesEnabled, &bs.WeeklyBonusEnabled, &bs.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch bonus settings"})
		return
	}
	c.JSON(http.StatusOK, bs)
}

func (h *AdminHandler) UpdateBonusSettings(c *gin.Context) {
	var req struct {
		NightBonusPct       *float64 `json:"night_bonus_pct"`
		NightBonusEnabled   *bool    `json:"night_bonus_enabled"`
		StreakDaysRequired  *int     `json:"streak_days_required"`
		StreakBonusAmount   *float64 `json:"streak_bonus_amount"`
		StreakBonusEnabled  *bool    `json:"streak_bonus_enabled"`
		Milestone50Amount  *float64 `json:"milestone_50_amount"`
		Milestone100Amount *float64 `json:"milestone_100_amount"`
		Milestone500Amount *float64 `json:"milestone_500_amount"`
		Milestone1000Amount *float64 `json:"milestone_1000_amount"`
		MilestonesEnabled  *bool    `json:"milestones_enabled"`
		WeeklyBonusEnabled *bool    `json:"weekly_bonus_enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.NightBonusPct != nil && (*req.NightBonusPct < 0 || *req.NightBonusPct > 100) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "night_bonus_pct must be 0–100"})
		return
	}
	_, err := h.db.Exec(context.Background(),
		`UPDATE bonus_settings SET
		 night_bonus_pct       = COALESCE($1,  night_bonus_pct),
		 night_bonus_enabled   = COALESCE($2,  night_bonus_enabled),
		 streak_days_required  = COALESCE($3,  streak_days_required),
		 streak_bonus_amount   = COALESCE($4,  streak_bonus_amount),
		 streak_bonus_enabled  = COALESCE($5,  streak_bonus_enabled),
		 milestone_50_amount   = COALESCE($6,  milestone_50_amount),
		 milestone_100_amount  = COALESCE($7,  milestone_100_amount),
		 milestone_500_amount  = COALESCE($8,  milestone_500_amount),
		 milestone_1000_amount = COALESCE($9,  milestone_1000_amount),
		 milestones_enabled    = COALESCE($10, milestones_enabled),
		 weekly_bonus_enabled  = COALESCE($11, weekly_bonus_enabled),
		 updated_at = NOW()`,
		req.NightBonusPct, req.NightBonusEnabled,
		req.StreakDaysRequired, req.StreakBonusAmount, req.StreakBonusEnabled,
		req.Milestone50Amount, req.Milestone100Amount, req.Milestone500Amount, req.Milestone1000Amount,
		req.MilestonesEnabled, req.WeeklyBonusEnabled,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update bonus settings"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Bonus settings updated"})
}

// GET /admin/bonus-events?limit=100 — recent bonus payouts across all drivers
func (h *AdminHandler) GetBonusEvents(c *gin.Context) {
	limit := 100
	rows, err := h.db.Query(context.Background(),
		`SELECT be.id, be.driver_id, be.bonus_type, be.amount, COALESCE(be.description,''), be.created_at,
		        u.first_name || ' ' || u.last_name, u.phone
		 FROM driver_bonus_events be
		 JOIN drivers d ON d.id = be.driver_id
		 JOIN users u ON u.id = d.user_id
		 ORDER BY be.created_at DESC LIMIT $1`, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	events := []models.BonusEvent{}
	for rows.Next() {
		var e models.BonusEvent
		if err := rows.Scan(&e.ID, &e.DriverID, &e.BonusType, &e.Amount, &e.Description, &e.CreatedAt,
			&e.DriverName, &e.DriverPhone); err != nil {
			continue
		}
		events = append(events, e)
	}
	c.JSON(http.StatusOK, gin.H{"events": events})
}

// GET /admin/weekly-bonus-tiers — returns all 7 weekly bonus tier configurations
func (h *AdminHandler) GetWeeklyBonusTiers(c *gin.Context) {
	rows, err := h.db.Query(context.Background(),
		`SELECT week_number, required_trips, bonus_amount FROM weekly_bonus_tiers ORDER BY week_number`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	tiers := []models.WeeklyBonusTier{}
	for rows.Next() {
		var t models.WeeklyBonusTier
		if err := rows.Scan(&t.WeekNumber, &t.RequiredTrips, &t.BonusAmount); err != nil {
			continue
		}
		tiers = append(tiers, t)
	}
	c.JSON(http.StatusOK, gin.H{"tiers": tiers})
}

// PUT /admin/weekly-bonus-tiers — update all 7 tiers at once
func (h *AdminHandler) UpdateWeeklyBonusTiers(c *gin.Context) {
	var req struct {
		Tiers []models.WeeklyBonusTier `json:"tiers" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Tiers) > 7 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Maximum 7 tiers allowed"})
		return
	}
	for _, t := range req.Tiers {
		if t.WeekNumber < 1 || t.WeekNumber > 7 {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("week_number must be 1-7, got %d", t.WeekNumber)})
			return
		}
		if t.RequiredTrips < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "required_trips must be >= 1"})
			return
		}
		if t.BonusAmount < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bonus_amount must be >= 0"})
			return
		}
	}
	ctx := context.Background()
	for _, t := range req.Tiers {
		_, err := h.db.Exec(ctx,
			`INSERT INTO weekly_bonus_tiers (week_number, required_trips, bonus_amount)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (week_number) DO UPDATE SET required_trips = $2, bonus_amount = $3`,
			t.WeekNumber, t.RequiredTrips, t.BonusAmount)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "Weekly bonus tiers updated"})
}

// ── Driver Balance Management ─────────────────────────────────────────────────

// GET /admin/driver-balances — list all drivers with balance info
func (h *AdminHandler) GetDriverBalances(c *gin.Context) {
	rows, err := h.db.Query(context.Background(),
		`SELECT d.id, u.first_name || ' ' || u.last_name AS name, u.phone,
		        COALESCE(d.balance, 0), COALESCE(d.balance_exempt, false),
		        d.is_available, COALESCE(d.registration_status, 'approved')
		 FROM drivers d
		 JOIN users u ON u.id = d.user_id
		 ORDER BY d.balance ASC, u.first_name`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type driverBalance struct {
		DriverID   string  `json:"driver_id"`
		Name       string  `json:"name"`
		Phone      string  `json:"phone"`
		Balance    float64 `json:"balance"`
		Exempt     bool    `json:"exempt"`
		Available  bool    `json:"is_available"`
		RegStatus  string  `json:"registration_status"`
	}
	list := []driverBalance{}
	for rows.Next() {
		var d driverBalance
		if err := rows.Scan(&d.DriverID, &d.Name, &d.Phone, &d.Balance, &d.Exempt, &d.Available, &d.RegStatus); err != nil {
			continue
		}
		list = append(list, d)
	}
	c.JSON(http.StatusOK, gin.H{"drivers": list})
}

// POST /admin/driver-balances/:id/top-up — admin adds money to a driver's balance
func (h *AdminHandler) TopUpDriverBalance(c *gin.Context) {
	driverID := c.Param("id")
	adminID := c.GetString("admin_id")
	var req struct {
		Amount      float64 `json:"amount" binding:"required"`
		Description string  `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Amount must be positive"})
		return
	}
	if req.Description == "" {
		req.Description = "Пополнение администратором"
	}
	ctx := context.Background()
	_, err := h.db.Exec(ctx,
		`UPDATE drivers SET balance = balance + $1 WHERE id = $2`, req.Amount, driverID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update balance"})
		return
	}
	h.db.Exec(ctx,
		`INSERT INTO balance_transactions (driver_id, amount, tx_type, description, admin_id)
		 VALUES ($1, $2, 'top_up', $3, $4)`,
		driverID, req.Amount, req.Description, adminID)

	// Fetch new balance
	var newBalance float64
	h.db.QueryRow(ctx, `SELECT COALESCE(balance, 0) FROM drivers WHERE id = $1`, driverID).Scan(&newBalance)

	// Notify driver via WebSocket
	var driverUserID string
	if err := h.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id = $1`, driverID).Scan(&driverUserID); err == nil {
		msg := fmt.Sprintf(`{"type":"balance_updated","balance":%.2f,"amount":%.2f,"tx_type":"top_up"}`, newBalance, req.Amount)
		h.hub.SendToUser(driverUserID, []byte(msg))
	}

	c.JSON(http.StatusOK, gin.H{"message": "Balance topped up", "new_balance": newBalance})
}

// PUT /admin/driver-balances/:id/exempt — toggle balance_exempt flag
func (h *AdminHandler) SetDriverExempt(c *gin.Context) {
	driverID := c.Param("id")
	var req struct {
		Exempt bool `json:"exempt"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	_, err := h.db.Exec(context.Background(),
		`UPDATE drivers SET balance_exempt = $1 WHERE id = $2`, req.Exempt, driverID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update exempt status"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Exempt status updated", "exempt": req.Exempt})
}

// GET /admin/balance-transactions — all balance transactions, latest first
func (h *AdminHandler) GetBalanceTransactions(c *gin.Context) {
	driverID := c.Query("driver_id")
	var query string
	var args []interface{}
	if driverID != "" {
		query = `SELECT bt.id, bt.driver_id, u.first_name || ' ' || u.last_name AS driver_name,
		         u.phone, bt.amount, bt.tx_type, COALESCE(bt.description,''), bt.order_id, bt.admin_id, bt.created_at
		         FROM balance_transactions bt
		         JOIN drivers d ON d.id = bt.driver_id
		         JOIN users u ON u.id = d.user_id
		         WHERE bt.driver_id = $1
		         ORDER BY bt.created_at DESC LIMIT 200`
		args = append(args, driverID)
	} else {
		query = `SELECT bt.id, bt.driver_id, u.first_name || ' ' || u.last_name AS driver_name,
		         u.phone, bt.amount, bt.tx_type, COALESCE(bt.description,''), bt.order_id, bt.admin_id, bt.created_at
		         FROM balance_transactions bt
		         JOIN drivers d ON d.id = bt.driver_id
		         JOIN users u ON u.id = d.user_id
		         ORDER BY bt.created_at DESC LIMIT 200`
	}
	rows, err := h.db.Query(context.Background(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type txRow struct {
		ID          string     `json:"id"`
		DriverID    string     `json:"driver_id"`
		DriverName  string     `json:"driver_name"`
		DriverPhone string     `json:"driver_phone"`
		Amount      float64    `json:"amount"`
		TxType      string     `json:"tx_type"`
		Description string     `json:"description"`
		OrderID     *string    `json:"order_id"`
		AdminID     *string    `json:"admin_id"`
		CreatedAt   time.Time  `json:"created_at"`
	}
	list := []txRow{}
	for rows.Next() {
		var t txRow
		if err := rows.Scan(&t.ID, &t.DriverID, &t.DriverName, &t.DriverPhone,
			&t.Amount, &t.TxType, &t.Description, &t.OrderID, &t.AdminID, &t.CreatedAt); err != nil {
			continue
		}
		list = append(list, t)
	}
	c.JSON(http.StatusOK, gin.H{"transactions": list})
}

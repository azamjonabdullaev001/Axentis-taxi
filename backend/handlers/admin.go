package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"axentis-taxi/config"
	"axentis-taxi/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type AdminHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewAdminHandler(db *pgxpool.Pool, cfg *config.Config) *AdminHandler {
	return &AdminHandler{db: db, cfg: cfg}
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
		 o.surge_multiplier, o.created_at, o.completed_at
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

		rows.Scan(&id, &status, &passName, &passPhone, &driverName, &driverPhone, &carNum,
			&pickupAddr, &destAddr, &distKm, &basePrice, &waitFee, &serviceFee, &totalPrice,
			&surgeMultiplier, &createdAt, &completedAt)

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
		 service_fee, surge_multiplier, COALESCE(base_surge_multiplier, 1.0), updated_at
		 FROM price_settings ORDER BY id LIMIT 1`,
	).Scan(&ps.ID, &ps.PricePerKm, &ps.PricePerMinuteWait, &ps.FreeWaitMinutes,
		&ps.ServiceFee, &ps.SurgeMultiplier, &ps.BaseSurgeMultiplier, &ps.UpdatedAt)
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

	_, err := h.db.Exec(context.Background(),
		`UPDATE price_settings SET
		 price_per_km = COALESCE($1, price_per_km),
		 price_per_minute_wait = COALESCE($2, price_per_minute_wait),
		 free_wait_minutes = COALESCE($3, free_wait_minutes),
		 service_fee = COALESCE($4, service_fee),
		 base_surge_multiplier = COALESCE($5, base_surge_multiplier),
		 updated_at = NOW()`,
		req.PricePerKm, req.PricePerMinuteWait, req.FreeWaitMinutes,
		req.ServiceFee, req.BaseSurgeMultiplier,
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

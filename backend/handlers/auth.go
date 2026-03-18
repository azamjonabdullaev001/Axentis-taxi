package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"axentis-taxi/config"
	"axentis-taxi/middleware"
	"axentis-taxi/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewAuthHandler(db *pgxpool.Pool, cfg *config.Config) *AuthHandler {
	return &AuthHandler{db: db, cfg: cfg}
}

type RegisterPassengerRequest struct {
	FirstName string `json:"first_name" binding:"required"`
	LastName  string `json:"last_name" binding:"required"`
	Phone     string `json:"phone" binding:"required"`
	Password  string `json:"password" binding:"required,min=8"`
	ConfirmPw string `json:"confirm_password" binding:"required"`
}

type RegisterDriverRequest struct {
	FirstName string `json:"first_name" binding:"required"`
	LastName  string `json:"last_name" binding:"required"`
	Phone     string `json:"phone" binding:"required"`
	Password  string `json:"password" binding:"required,min=8"`
	ConfirmPw string `json:"confirm_password" binding:"required"`
	CarNumber string `json:"car_number" binding:"required"`
}

type LoginRequest struct {
	Phone    string `json:"phone" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func (h *AuthHandler) RegisterPassenger(c *gin.Context) {
	var req RegisterPassengerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Password != req.ConfirmPw {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Passwords do not match"})
		return
	}

	normalizedPhone := normalizePhone(req.Phone)
	if !isValidUzPhone(normalizedPhone) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid Uzbekistan phone number"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	var userID string
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO users (first_name, last_name, phone, password_hash, role)
		 VALUES ($1, $2, $3, $4, 'passenger') RETURNING id`,
		req.FirstName, req.LastName, normalizedPhone, string(hash),
	).Scan(&userID)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			c.JSON(http.StatusConflict, gin.H{"error": "Phone number already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	token, err := generateUserToken(userID, "passenger", h.cfg.JWTSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"token": token, "user_id": userID, "role": "passenger"})
}

func (h *AuthHandler) RegisterDriver(c *gin.Context) {
	var req RegisterDriverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Password != req.ConfirmPw {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Passwords do not match"})
		return
	}

	normalizedPhone := normalizePhone(req.Phone)
	if !isValidUzPhone(normalizedPhone) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid Uzbekistan phone number"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
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
		req.FirstName, req.LastName, normalizedPhone, string(hash),
	).Scan(&userID)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			c.JSON(http.StatusConflict, gin.H{"error": "Phone number already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	_, err = tx.Exec(context.Background(),
		`INSERT INTO drivers (user_id, car_number) VALUES ($1, $2)`,
		userID, strings.ToUpper(req.CarNumber),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create driver profile"})
		return
	}

	if err := tx.Commit(context.Background()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit transaction"})
		return
	}

	token, err := generateUserToken(userID, "driver", h.cfg.JWTSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"token": token, "user_id": userID, "role": "driver"})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	normalizedPhone := normalizePhone(req.Phone)
	var user models.User
	err := h.db.QueryRow(context.Background(),
		`SELECT id, first_name, last_name, phone, password_hash, role, is_active
		 FROM users WHERE phone = $1`,
		normalizedPhone,
	).Scan(&user.ID, &user.FirstName, &user.LastName, &user.Phone,
		&user.PasswordHash, &user.Role, &user.IsActive)

	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid phone or password"})
		return
	}
	if !user.IsActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is deactivated"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid phone or password"})
		return
	}

	token, err := generateUserToken(user.ID, user.Role, h.cfg.JWTSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token, "user_id": user.ID, "role": user.Role})
}

func (h *AuthHandler) GetProfile(c *gin.Context) {
	userID := c.GetString("user_id")
	role := c.GetString("user_role")

	var user models.User
	err := h.db.QueryRow(context.Background(),
		`SELECT id, first_name, last_name, phone, role, avatar_url, dark_mode, language, created_at
		 FROM users WHERE id = $1`,
		userID,
	).Scan(&user.ID, &user.FirstName, &user.LastName, &user.Phone,
		&user.Role, &user.AvatarURL, &user.DarkMode, &user.Language, &user.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if role == "driver" {
		var driver models.Driver
		err = h.db.QueryRow(context.Background(),
			`SELECT id, car_number, is_available FROM drivers WHERE user_id = $1`,
			userID,
		).Scan(&driver.ID, &driver.CarNumber, &driver.IsAvailable)
		if err == nil {
			c.JSON(http.StatusOK, gin.H{"user": user, "driver": driver})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
		AvatarURL string `json:"avatar_url"`
		DarkMode  *bool  `json:"dark_mode"`
		Language  string `json:"language"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err := h.db.Exec(context.Background(),
		`UPDATE users SET first_name = COALESCE(NULLIF($1,''), first_name),
		 last_name = COALESCE(NULLIF($2,''), last_name),
		 avatar_url = COALESCE(NULLIF($3,''), avatar_url),
		 dark_mode = COALESCE($4, dark_mode),
		 language = COALESCE(NULLIF($5,''), language),
		 updated_at = NOW() WHERE id = $6`,
		req.FirstName, req.LastName, req.AvatarURL, req.DarkMode, req.Language, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update profile"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Profile updated"})
}

func generateUserToken(userID, role, secret string) (string, error) {
	claims := &middleware.Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func normalizePhone(phone string) string {
	phone = strings.ReplaceAll(phone, " ", "")
	phone = strings.ReplaceAll(phone, "-", "")
	if !strings.HasPrefix(phone, "+") {
		phone = "+" + phone
	}
	return phone
}

func isValidUzPhone(phone string) bool {
	if !strings.HasPrefix(phone, "+998") {
		return false
	}
	digits := strings.TrimPrefix(phone, "+")
	return len(digits) == 12
}

package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

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

	normalizedCarNumber := normalizeCarNumber(req.CarNumber)
	if !isValidUzCarNumber(normalizedCarNumber) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid Uzbekistan car number"})
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
		userID, normalizedCarNumber,
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
		`SELECT id, first_name, last_name, phone, role, avatar_url, dark_mode, language, share_live_location, created_at
		 FROM users WHERE id = $1`,
		userID,
	).Scan(&user.ID, &user.FirstName, &user.LastName, &user.Phone,
		&user.Role, &user.AvatarURL, &user.DarkMode, &user.Language, &user.ShareLiveLocation, &user.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if role == "driver" {
		var driver models.Driver
		err = h.db.QueryRow(context.Background(),
			`SELECT id, car_number, is_available, current_lat, current_lng, current_heading, last_seen FROM drivers WHERE user_id = $1`,
			userID,
		).Scan(&driver.ID, &driver.CarNumber, &driver.IsAvailable, &driver.CurrentLat, &driver.CurrentLng, &driver.CurrentHeading, &driver.LastSeen)
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

func (h *AuthHandler) UploadAvatar(c *gin.Context) {
	userID := c.GetString("user_id")

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
		return
	}
	defer file.Close()

	// Validate extension
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == ".jpeg" {
		ext = ".jpg"
	}
	allowed := map[string]bool{".jpg": true, ".png": true, ".webp": true}
	if !allowed[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only jpg, png, webp images are allowed"})
		return
	}

	// Limit to 5 MB
	if header.Size > 5*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "File too large (max 5 MB)"})
		return
	}

	// Unique filename
	b := make([]byte, 16)
	rand.Read(b)
	filename := hex.EncodeToString(b) + ext

	dir := "./uploads/avatars"
	if err := os.MkdirAll(dir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create upload directory"})
		return
	}

	dst, err := os.Create(filepath.Join(dir, filename))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to write file"})
		return
	}

	avatarPath := "/uploads/avatars/" + filename
	_, err = h.db.Exec(context.Background(),
		`UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2`,
		avatarPath, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update avatar"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": avatarPath})
}

func (h *AuthHandler) SavePushToken(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		PushToken string `json:"push_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !strings.HasPrefix(req.PushToken, "ExponentPushToken[") &&
		!strings.HasPrefix(req.PushToken, "ExpoPushToken[") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid Expo push token format"})
		return
	}
	h.db.Exec(context.Background(),
		`UPDATE users SET push_token = $1, updated_at = NOW() WHERE id = $2`,
		req.PushToken, userID,
	)
	c.JSON(http.StatusOK, gin.H{"message": "Push token registered"})
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

func normalizeCarNumber(carNumber string) string {
	var normalized strings.Builder
	for _, char := range strings.ToUpper(carNumber) {
		if unicode.IsDigit(char) || (char >= 'A' && char <= 'Z') {
			normalized.WriteRune(char)
		}
	}
	return normalized.String()
}

func isValidUzCarNumber(carNumber string) bool {
	validRegions := map[string]struct{}{
		"01": {}, "10": {}, "20": {}, "30": {}, "40": {}, "50": {}, "60": {},
		"70": {}, "75": {}, "80": {}, "85": {}, "90": {}, "95": {},
	}

	if len(carNumber) < 6 || len(carNumber) > 8 {
		return false
	}

	regionCode := carNumber[:2]
	if _, ok := validRegions[regionCode]; !ok {
		return false
	}

	suffix := carNumber[2:]
	if len(suffix) < 4 || len(suffix) > 6 {
		return false
	}

	hasLetter := false
	hasDigit := false
	for _, char := range suffix {
		switch {
		case unicode.IsDigit(char):
			hasDigit = true
		case char >= 'A' && char <= 'Z':
			hasLetter = true
		default:
			return false
		}
	}

	return hasLetter && hasDigit
}

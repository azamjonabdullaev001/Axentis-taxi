package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"math/big"
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
	FirstName   string `json:"first_name" binding:"required"`
	LastName    string `json:"last_name" binding:"required"`
	Phone       string `json:"phone" binding:"required"`
	Password    string `json:"password" binding:"required,min=8"`
	ConfirmPw   string `json:"confirm_password" binding:"required"`
	CarNumber   string `json:"car_number" binding:"required"`
	PINFL       string `json:"pinfl"`
	ReferredBy  string `json:"referred_by"`
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
	var selfieURL, licenseFrontURL, licenseBackURL, idDocumentURL string

	if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		req = RegisterDriverRequest{
			FirstName:  strings.TrimSpace(c.PostForm("first_name")),
			LastName:   strings.TrimSpace(c.PostForm("last_name")),
			Phone:      strings.TrimSpace(c.PostForm("phone")),
			Password:   c.PostForm("password"),
			ConfirmPw:  c.PostForm("confirm_password"),
			CarNumber:  strings.TrimSpace(c.PostForm("car_number")),
			ReferredBy: strings.TrimSpace(c.PostForm("referred_by")),
		}

		selfie, err := c.FormFile("selfie")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Selfie is required"})
			return
		}
		licenseFront, err := c.FormFile("license_front")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Driver license (front) is required"})
			return
		}
		licenseBack, err := c.FormFile("license_back")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Driver license (back) is required"})
			return
		}
		idDoc, err := c.FormFile("id_document")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Passport or ID card image is required"})
			return
		}

		selfieURL, err = saveUploadedImage(selfie, "driver-docs")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		licenseFrontURL, err = saveUploadedImage(licenseFront, "driver-docs")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		licenseBackURL, err = saveUploadedImage(licenseBack, "driver-docs")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		idDocumentURL, err = saveUploadedImage(idDoc, "driver-docs")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Use multipart/form-data with selfie, license_front, license_back, id_document"})
		return
	}

	if strings.TrimSpace(req.FirstName) == "" || strings.TrimSpace(req.LastName) == "" ||
		strings.TrimSpace(req.Phone) == "" || strings.TrimSpace(req.Password) == "" || strings.TrimSpace(req.CarNumber) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "All required fields must be filled"})
		return
	}
	if len(req.Password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Password must be at least 8 characters"})
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

	refCode, err := generateUniqueReferralCode(context.Background(), h.db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate referral code"})
		return
	}

	// Validate referred_by code if provided
	var referredBy *string
	if req.ReferredBy != "" {
		var exists bool
		tx.QueryRow(context.Background(),
			`SELECT EXISTS(SELECT 1 FROM drivers WHERE referral_code = $1)`,
			req.ReferredBy,
		).Scan(&exists)
		if exists {
			referredBy = &req.ReferredBy
		}
	}

	_, err = tx.Exec(context.Background(),
		`INSERT INTO drivers
		 (user_id, car_number, referral_code, referred_by, registration_status,
		  selfie_url, license_front_url, license_back_url, id_document_url)
		 VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)`,
		userID, normalizedCarNumber, refCode, referredBy,
		selfieURL, licenseFrontURL, licenseBackURL, idDocumentURL,
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
		"user_id":          userID,
		"role":             "driver",
		"referral_code":    refCode,
		"registration_status": "pending",
		"message":          "Registration submitted and waiting for admin approval",
	})
}

// ApplyReferral lets a driver choose a referral benefit after entering a referral code.
func (h *AuthHandler) ApplyReferral(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		ReferralCode string `json:"referral_code" binding:"required"`
		BenefitType  string `json:"benefit_type" binding:"required"` // "commission" or "bonus"
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.BenefitType != "commission" && req.BenefitType != "bonus" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "benefit_type must be 'commission' or 'bonus'"})
		return
	}

	// Make sure the referral code exists and does not belong to the same driver
	var referrerDriverID string
	err := h.db.QueryRow(context.Background(),
		`SELECT id FROM drivers WHERE referral_code = $1`, req.ReferralCode,
	).Scan(&referrerDriverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Referral code not found"})
		return
	}

	// Get the current driver's ID
	var driverID string
	var currentReferred *string
	err = h.db.QueryRow(context.Background(),
		`SELECT id, referred_by FROM drivers WHERE user_id = $1`, userID,
	).Scan(&driverID, &currentReferred)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver profile not found"})
		return
	}
	if driverID == referrerDriverID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot use your own referral code"})
		return
	}
	if currentReferred != nil && *currentReferred != "" {
		c.JSON(http.StatusConflict, gin.H{"error": "Referral already applied"})
		return
	}

	_, err = h.db.Exec(context.Background(),
		`UPDATE drivers SET referred_by = $1, referral_benefit_type = $2 WHERE user_id = $3`,
		req.ReferralCode, req.BenefitType, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to apply referral"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Referral applied", "benefit_type": req.BenefitType})
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

	if user.Role == "driver" {
		var registrationStatus string
		var reviewComment string
		err = h.db.QueryRow(context.Background(),
			`SELECT COALESCE(registration_status, 'pending'), COALESCE(review_comment, '')
			 FROM drivers WHERE user_id = $1`,
			user.ID,
		).Scan(&registrationStatus, &reviewComment)
		if err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "Driver profile not found"})
			return
		}
		if registrationStatus != "approved" {
			resp := gin.H{"error": "Driver account is pending admin approval", "registration_status": registrationStatus}
			if registrationStatus == "rejected" && reviewComment != "" {
				resp["review_comment"] = reviewComment
			}
			c.JSON(http.StatusForbidden, resp)
			return
		}
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
		var referralCode, referredBy, referralBenefitType *string
		var reviewedByAdminID *string
		err = h.db.QueryRow(context.Background(),
			`SELECT id, car_number, COALESCE(pinfl,''), is_available, current_lat, current_lng, current_heading, last_seen,
			 COALESCE(referral_code,''), COALESCE(referred_by,''), COALESCE(referral_benefit_type,''),
			 COALESCE(balance,0), COALESCE(registration_status,'pending'),
			 reviewed_by_admin_id::text, reviewed_at, COALESCE(review_comment,''),
			 COALESCE(selfie_url,''), COALESCE(license_front_url,''),
			 COALESCE(license_back_url,''), COALESCE(id_document_url,'')
			 FROM drivers WHERE user_id = $1`,
			userID,
		).Scan(&driver.ID, &driver.CarNumber, &driver.PINFL, &driver.IsAvailable,
			&driver.CurrentLat, &driver.CurrentLng, &driver.CurrentHeading, &driver.LastSeen,
			&referralCode, &referredBy, &referralBenefitType, &driver.Balance,
			&driver.RegistrationStatus, &reviewedByAdminID, &driver.ReviewedAt, &driver.ReviewComment,
			&driver.SelfieURL, &driver.LicenseFrontURL, &driver.LicenseBackURL, &driver.IDDocumentURL)
		if err == nil {
			if referralCode != nil {
				driver.ReferralCode = *referralCode
			}
			if referredBy != nil {
				driver.ReferredBy = *referredBy
			}
			if referralBenefitType != nil {
				driver.ReferralBenefitType = *referralBenefitType
			}
			if reviewedByAdminID != nil {
				driver.ReviewedByAdminID = *reviewedByAdminID
			}
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

func saveUploadedImage(header *multipart.FileHeader, subDir string) (string, error) {
	file, err := header.Open()
	if err != nil {
		return "", fmt.Errorf("failed to read uploaded file")
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == ".jpeg" {
		ext = ".jpg"
	}
	allowed := map[string]bool{".jpg": true, ".png": true, ".webp": true}
	if !allowed[ext] {
		return "", fmt.Errorf("only jpg, png, webp images are allowed")
	}
	if header.Size > 5*1024*1024 {
		return "", fmt.Errorf("file too large (max 5 MB)")
	}

	b := make([]byte, 16)
	rand.Read(b)
	filename := hex.EncodeToString(b) + ext

	dir := filepath.Join("./uploads", subDir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create upload directory")
	}

	dst, err := os.Create(filepath.Join(dir, filename))
	if err != nil {
		return "", fmt.Errorf("failed to save file")
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		return "", fmt.Errorf("failed to write file")
	}

	return "/uploads/" + subDir + "/" + filename, nil
}

func (h *AuthHandler) UploadAvatar(c *gin.Context) {
	userID := c.GetString("user_id")

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
		return
	}
	defer file.Close()

	_ = file
	avatarPath, err := saveUploadedImage(header, "avatars")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
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

// generateUniqueReferralCode creates a random 7-digit numeric string unique in the drivers table.
func generateUniqueReferralCode(ctx context.Context, db *pgxpool.Pool) (string, error) {
	for i := 0; i < 20; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(9000000))
		if err != nil {
			return "", err
		}
		code := fmt.Sprintf("%07d", n.Int64()+1000000)
		var exists bool
		db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM drivers WHERE referral_code = $1)`, code).Scan(&exists)
		if !exists {
			return code, nil
		}
	}
	return "", fmt.Errorf("failed to generate unique referral code after 20 attempts")
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

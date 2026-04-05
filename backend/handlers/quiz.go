package handlers

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type QuizHandler struct {
	db *pgxpool.Pool
}

func NewQuizHandler(db *pgxpool.Pool) *QuizHandler {
	return &QuizHandler{db: db}
}

type SubmitQuizRequest struct {
	OrderID        *string `json:"order_id"`
	Score          int     `json:"score"`
	TotalQuestions int     `json:"total_questions"`
	CorrectAnswers int     `json:"correct_answers"`
}

// POST /quiz/submit — saves a completed quiz session to the database
func (h *QuizHandler) SubmitScore(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req SubmitQuizRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.TotalQuestions <= 0 || req.Score < 0 || req.CorrectAnswers < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid quiz data"})
		return
	}

	var id string
	err := h.db.QueryRow(context.Background(),
		`INSERT INTO quiz_scores (user_id, order_id, score, total_questions, correct_answers)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		userID, req.OrderID, req.Score, req.TotalQuestions, req.CorrectAnswers,
	).Scan(&id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save quiz score"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":    id,
		"score": req.Score,
	})
}

// GET /quiz/my-scores — returns the current user's quiz history
func (h *QuizHandler) GetMyScores(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT id, user_id, order_id, score, total_questions, correct_answers, played_at
		 FROM quiz_scores
		 WHERE user_id = $1
		 ORDER BY played_at DESC
		 LIMIT 50`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch scores"})
		return
	}
	defer rows.Close()

	type scoreRow struct {
		ID             string  `json:"id"`
		UserID         string  `json:"user_id"`
		OrderID        *string `json:"order_id"`
		Score          int     `json:"score"`
		TotalQuestions int     `json:"total_questions"`
		CorrectAnswers int     `json:"correct_answers"`
		PlayedAt       string  `json:"played_at"`
	}

	var scores []scoreRow
	for rows.Next() {
		var s scoreRow
		if err := rows.Scan(&s.ID, &s.UserID, &s.OrderID, &s.Score, &s.TotalQuestions, &s.CorrectAnswers, &s.PlayedAt); err != nil {
			continue
		}
		scores = append(scores, s)
	}

	if scores == nil {
		scores = []scoreRow{}
	}

	c.JSON(http.StatusOK, gin.H{"scores": scores})
}

// GET /quiz/total-score — returns the user's total accumulated score (for future leaderboard)
func (h *QuizHandler) GetTotalScore(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var total int
	err := h.db.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(score), 0) FROM quiz_scores WHERE user_id = $1`,
		userID,
	).Scan(&total)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get total score"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"total_score": total, "user_id": userID})
}

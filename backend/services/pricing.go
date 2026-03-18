package services

import (
	"context"
	"log"
	"math"
	"time"

	"axentis-taxi/models"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/robfig/cron/v3"
)

type PricingService struct {
	db   *pgxpool.Pool
	cron *cron.Cron
}

func NewPricingService(db *pgxpool.Pool) *PricingService {
	return &PricingService{
		db:   db,
		cron: cron.New(),
	}
}

func (s *PricingService) GetSettings() (*models.PriceSettings, error) {
	var ps models.PriceSettings
	err := s.db.QueryRow(context.Background(),
		`SELECT id, price_per_km, price_per_minute_wait, free_wait_minutes,
		 service_fee, surge_multiplier, updated_at
		 FROM price_settings ORDER BY id LIMIT 1`,
	).Scan(&ps.ID, &ps.PricePerKm, &ps.PricePerMinuteWait, &ps.FreeWaitMinutes,
		&ps.ServiceFee, &ps.SurgeMultiplier, &ps.UpdatedAt)
	return &ps, err
}

func (s *PricingService) CalculatePrice(distanceKm float64) (basePrice, totalPrice float64, surge float64) {
	ps, err := s.GetSettings()
	if err != nil {
		// Fallback defaults
		return distanceKm * 2000, distanceKm*2000 + 2000, 1.0
	}
	surge = ps.SurgeMultiplier
	basePrice = distanceKm * ps.PricePerKm * surge
	totalPrice = basePrice + ps.ServiceFee
	return
}

func (s *PricingService) CalculateWaitFee(waitStartedAt *time.Time, freeMinutes int) float64 {
	if waitStartedAt == nil {
		return 0
	}
	elapsed := time.Since(*waitStartedAt).Minutes()
	billable := elapsed - float64(freeMinutes)
	if billable <= 0 {
		return 0
	}
	return math.Round(billable * 500)
}

// StartSurgeScheduler sets up automatic surge pricing based on time schedules
func (s *PricingService) StartSurgeScheduler() {
	// Every minute check for active schedules
	s.cron.AddFunc("* * * * *", func() {
		s.processSurgeSchedules()
	})
	s.cron.Start()
	log.Println("Surge scheduler started")
}

func (s *PricingService) processSurgeSchedules() {
	now := time.Now()
	currentTime := now.Format("15:04:05")

	rows, err := s.db.Query(context.Background(),
		`SELECT id, target_multiplier, start_time, duration_minutes, direction
		 FROM surge_schedules
		 WHERE is_active = true
		   AND start_time <= $1::time
		   AND (start_time + (duration_minutes || ' minutes')::interval) >= $1::time`,
		currentTime,
	)
	if err != nil {
		return
	}
	defer rows.Close()

	var schedule models.SurgeSchedule
	if rows.Next() {
		rows.Scan(&schedule.ID, &schedule.TargetMultiplier, &schedule.StartTime,
			&schedule.DurationMinutes, &schedule.Direction)

		ps, err := s.GetSettings()
		if err != nil {
			return
		}

		// Parse start time to calculate how far into the schedule we are
		startT, err := time.Parse("15:04:05", schedule.StartTime)
		if err != nil {
			return
		}

		todayStart := time.Date(now.Year(), now.Month(), now.Day(),
			startT.Hour(), startT.Minute(), startT.Second(), 0, now.Location())
		elapsed := now.Sub(todayStart).Minutes()
		progress := elapsed / float64(schedule.DurationMinutes)
		if progress > 1.0 {
			progress = 1.0
		}

		var newMultiplier float64

		if schedule.Direction == "up" {
			newMultiplier = ps.SurgeMultiplier + (schedule.TargetMultiplier-ps.SurgeMultiplier)*progress
		} else {
			newMultiplier = ps.SurgeMultiplier - (ps.SurgeMultiplier-schedule.TargetMultiplier)*progress
		}

		// Clamp to safe range: 0.25 to 3.5
		if newMultiplier < 0.25 {
			newMultiplier = 0.25
		}
		if newMultiplier > 3.5 {
			newMultiplier = 3.5
		}

		s.db.Exec(context.Background(),
			`UPDATE price_settings SET surge_multiplier = $1, updated_at = NOW()`,
			newMultiplier,
		)
	}
}

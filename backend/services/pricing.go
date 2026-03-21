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
		 service_fee, surge_multiplier, COALESCE(base_surge_multiplier, 1.0), updated_at
		 FROM price_settings ORDER BY id LIMIT 1`,
	).Scan(&ps.ID, &ps.PricePerKm, &ps.PricePerMinuteWait, &ps.FreeWaitMinutes,
		&ps.ServiceFee, &ps.SurgeMultiplier, &ps.BaseSurgeMultiplier, &ps.UpdatedAt)
	return &ps, err
}

func (s *PricingService) CalculatePrice(distanceKm float64) (basePrice, totalPrice float64, surge float64) {
	surge = 1.0
	ps, err := s.GetSettings()
	if err == nil {
		if ps.SurgeMultiplier > 0 {
			surge = ps.SurgeMultiplier
		}
		// Цена = сервисный сбор + (км × цена_за_км), затем ×коэффициент
		// Округление ВВЕРХ до ближайших 200 сум (минимальная единица в Узбекистане)
		rawBase := ps.ServiceFee + distanceKm*ps.PricePerKm
		basePrice = math.Ceil(rawBase/200) * 200
		totalPrice = math.Ceil((basePrice*surge)/200) * 200
		return
	}
	// Fallback при ошибке БД
	blocks := math.Ceil(distanceKm * 10)
	if blocks < 1 {
		blocks = 1
	}
	rawBase := 2000 + blocks*200
	basePrice = math.Ceil(rawBase/200) * 200
	totalPrice = basePrice
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

// StartSurgeScheduler sets up automatic surge pricing based on peak period schedules
func (s *PricingService) StartSurgeScheduler() {
	// Every minute: apply active peak period or restore base multiplier
	s.cron.AddFunc("* * * * *", func() {
		s.processPeakPeriods()
	})
	s.cron.Start()
	log.Println("Peak period scheduler started")
}

func (s *PricingService) processPeakPeriods() {
	now := time.Now()
	nowMins := float64(now.Hour()*60 + now.Minute())

	// Collect all active peak periods
	type pp struct {
		startStr string
		endStr   string
		peak     float64
		riseMin  int
		fallMin  int
	}
	rows, err := s.db.Query(context.Background(),
		`SELECT start_time::text, end_time::text, peak_multiplier, rise_minutes, fall_minutes
		 FROM peak_periods WHERE is_active = true ORDER BY start_time`)
	if err != nil {
		return
	}
	var periods []pp
	for rows.Next() {
		var p pp
		rows.Scan(&p.startStr, &p.endStr, &p.peak, &p.riseMin, &p.fallMin)
		periods = append(periods, p)
	}
	rows.Close()

	for _, p := range periods {
		startT, e1 := time.Parse("15:04:05", p.startStr)
		endT, e2 := time.Parse("15:04:05", p.endStr)
		if e1 != nil || e2 != nil {
			continue
		}
		startMins := float64(startT.Hour()*60 + startT.Minute())
		endMins := float64(endT.Hour()*60 + endT.Minute())

		if nowMins < startMins || nowMins >= endMins {
			continue // not in this period's window
		}

		riseEndMins := startMins + float64(p.riseMin)
		fallStartMins := endMins - float64(p.fallMin)

		var multiplier float64
		switch {
		case nowMins <= riseEndMins:
			// Rising phase: 1.0 → peak over rise_minutes
			progress := (nowMins - startMins) / float64(p.riseMin)
			if progress > 1 {
				progress = 1
			}
			multiplier = 1.0 + (p.peak-1.0)*progress

		case nowMins >= fallStartMins:
			// Falling phase: peak → 1.0 over fall_minutes
			remaining := endMins - nowMins
			progress := remaining / float64(p.fallMin)
			if progress < 0 {
				progress = 0
			}
			multiplier = 1.0 + (p.peak-1.0)*progress

		default:
			// Peak phase: hold at maximum
			multiplier = p.peak
		}

		// Clamp to safe range
		if multiplier < 0.5 {
			multiplier = 0.5
		}
		if multiplier > 5.0 {
			multiplier = 5.0
		}

		s.db.Exec(context.Background(),
			`UPDATE price_settings SET surge_multiplier = $1, updated_at = NOW()`, multiplier)
		log.Printf("Peak period active: %.2f× (phase at %.0f min)", multiplier, nowMins)
		return
	}

	// No peak period active — restore live multiplier to the admin-set base value
	s.db.Exec(context.Background(),
		`UPDATE price_settings
		 SET surge_multiplier = COALESCE(base_surge_multiplier, 1.0), updated_at = NOW()
		 WHERE surge_multiplier != COALESCE(base_surge_multiplier, 1.0)`)
}

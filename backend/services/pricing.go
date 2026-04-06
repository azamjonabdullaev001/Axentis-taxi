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
		 service_fee, surge_multiplier, COALESCE(base_surge_multiplier, 1.0),
		 COALESCE(royal_price_per_km, 3000), updated_at
		 FROM price_settings ORDER BY id LIMIT 1`,
	).Scan(&ps.ID, &ps.PricePerKm, &ps.PricePerMinuteWait, &ps.FreeWaitMinutes,
		&ps.ServiceFee, &ps.SurgeMultiplier, &ps.BaseSurgeMultiplier,
		&ps.RoyalPricePerKm, &ps.UpdatedAt)
	return &ps, err
}

// CalculatePriceWithRate works exactly like CalculatePrice but uses the provided
// pricePerKm instead of the one stored in settings. Royal dispatcher orders use
// royal_price_per_km, but the formula (service_fee + distance + surge + 200-rounding)
// is IDENTICAL to Yandex orders — no separate algorithm.
func (s *PricingService) CalculatePriceWithRate(distanceKm float64, pricePerKm float64) (basePrice, totalPrice, surge, serviceFee float64) {
	surge = 1.0
	serviceFee = 2000 // fallback
	distMeters := distanceKm * 1000
	if distMeters < 1 {
		distMeters = 100
	}
	roundedKm := math.Ceil(distMeters/100) * 100 / 1000
	ps, err := s.GetSettings()
	if err == nil {
		serviceFee = ps.ServiceFee
		if ps.SurgeMultiplier > 0 {
			surge = ps.SurgeMultiplier
		}
		distCost := roundedKm * pricePerKm
		basePrice = math.Ceil((ps.ServiceFee + distCost) / 200) * 200
		totalPrice = math.Ceil((ps.ServiceFee + distCost*surge) / 200) * 200
		return
	}
	rawBase := 2000.0 + roundedKm*pricePerKm
	basePrice = math.Ceil(rawBase/200) * 200
	totalPrice = basePrice
	return
}

// CalculateRoyalPrice kept for backward compat but now delegates to CalculatePriceWithRate.
func (s *PricingService) CalculateRoyalPrice(distanceKm float64, pricePerKm float64) float64 {
	_, totalPrice, _, _ := s.CalculatePriceWithRate(distanceKm, pricePerKm)
	return totalPrice
}

// GetRoyalPricePerKm returns the royal tariff rate locked at order creation.
func (s *PricingService) GetRoyalPricePerKm() float64 {
	ps, err := s.GetSettings()
	if err != nil {
		return 3000
	}
	if ps.RoyalPricePerKm <= 0 {
		return 3000
	}
	return ps.RoyalPricePerKm
}

func (s *PricingService) CalculatePrice(distanceKm float64) (basePrice, totalPrice, surge, serviceFee float64) {
	surge = 1.0
	serviceFee = 2000 // fallback
	// Шаг 100 м: 1–99 м → 100 м, 100–199 м → 200 м, 1070 м → 1100 м, и т.д.
	// Каждые 100 м = 200 сум (при price_per_km = 2000)
	distMeters := distanceKm * 1000
	if distMeters < 1 {
		distMeters = 100 // минимум 1 блок = 100 м
	}
	roundedMeters := math.Ceil(distMeters/100) * 100
	roundedKm := roundedMeters / 1000
	ps, err := s.GetSettings()
	if err == nil {
		serviceFee = ps.ServiceFee
		if ps.SurgeMultiplier > 0 {
			surge = ps.SurgeMultiplier
		}
		// Сервисный сбор фиксированный, surge применяется только к километражу
		distCost := roundedKm * ps.PricePerKm
		basePrice = math.Ceil((ps.ServiceFee + distCost) / 200) * 200
		totalPrice = math.Ceil((ps.ServiceFee + distCost*surge) / 200) * 200
		return
	}
	// Fallback при ошибке БД
	rawBase := 2000.0 + roundedKm*2000
	basePrice = math.Ceil(rawBase/200) * 200
	totalPrice = basePrice
	return
}

// GetEffectivePricePerKm returns the RAW price-per-km from admin panel (WITHOUT surge).
// Surge is applied separately in pricing calculations. This ensures the locked rate
// matches what the admin sees in the pricing panel.
func (s *PricingService) GetEffectivePricePerKm() float64 {
	ps, err := s.GetSettings()
	if err != nil {
		return 2000
	}
	if ps.PricePerKm <= 0 {
		return 2000
	}
	return ps.PricePerKm
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

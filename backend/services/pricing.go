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
		 COALESCE(royal_price_per_km, 3000), COALESCE(service_share_pct, 10.0), updated_at
		 FROM price_settings ORDER BY id LIMIT 1`,
	).Scan(&ps.ID, &ps.PricePerKm, &ps.PricePerMinuteWait, &ps.FreeWaitMinutes,
		&ps.ServiceFee, &ps.SurgeMultiplier, &ps.BaseSurgeMultiplier,
		&ps.RoyalPricePerKm, &ps.ServiceSharePct, &ps.UpdatedAt)
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

// StartSurgeScheduler sets up automatic surge pricing based on hourly surge schedule
func (s *PricingService) StartSurgeScheduler() {
	// Every minute: apply hourly surge multiplier
	s.cron.AddFunc("* * * * *", func() {
		s.processHourlySurge()
	})
	s.cron.Start()
	log.Println("Hourly surge scheduler started")
}

func (s *PricingService) processHourlySurge() {
	hour := time.Now().Hour()

	var multiplier float64
	err := s.db.QueryRow(context.Background(),
		`SELECT COALESCE(multiplier, 1.0) FROM hourly_surge WHERE hour = $1`, hour,
	).Scan(&multiplier)
	if err != nil || multiplier <= 0 {
		multiplier = 1.0
	}

	// Clamp to safe range
	if multiplier < 0.5 {
		multiplier = 0.5
	}
	if multiplier > 5.0 {
		multiplier = 5.0
	}

	// Apply base_surge_multiplier * hourly multiplier
	s.db.Exec(context.Background(),
		`UPDATE price_settings
		 SET surge_multiplier = COALESCE(base_surge_multiplier, 1.0) * $1,
		     updated_at = NOW()
		 WHERE surge_multiplier != COALESCE(base_surge_multiplier, 1.0) * $1`,
		multiplier)
}

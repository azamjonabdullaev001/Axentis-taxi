package database

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}
	return pool, nil
}

func RunMigrations(db *pgxpool.Pool) error {
	_, err := db.Exec(context.Background(), schema)
	return err
}

const schema = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('passenger', 'driver')),
    avatar_url VARCHAR(500),
    dark_mode BOOLEAN DEFAULT false,
    language VARCHAR(10) DEFAULT 'ru',
    share_live_location BOOLEAN DEFAULT true,
    push_token VARCHAR(500),
    current_lat DOUBLE PRECISION,
    current_lng DOUBLE PRECISION,
    current_heading DOUBLE PRECISION,
    last_location_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    car_number VARCHAR(20) NOT NULL,
    is_available BOOLEAN DEFAULT false,
    current_lat DOUBLE PRECISION,
    current_lng DOUBLE PRECISION,
    current_heading DOUBLE PRECISION,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS share_live_location BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_lng DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_heading DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS current_heading DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS dark_mode BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'ru';

CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    access_token VARCHAR(20) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID REFERENCES users(id),
    driver_id UUID REFERENCES drivers(id),
    status VARCHAR(30) NOT NULL DEFAULT 'searching',
    pickup_lat DOUBLE PRECISION NOT NULL,
    pickup_lng DOUBLE PRECISION NOT NULL,
    pickup_address VARCHAR(500),
    destination_lat DOUBLE PRECISION NOT NULL,
    destination_lng DOUBLE PRECISION NOT NULL,
    destination_address VARCHAR(500),
    distance_km DOUBLE PRECISION,
    base_price DECIMAL(12,2),
    waiting_time_minutes DECIMAL(10,2) DEFAULT 0,
    waiting_fee DECIMAL(12,2) DEFAULT 0,
    service_fee DECIMAL(12,2) DEFAULT 2000,
    total_price DECIMAL(12,2),
    surge_multiplier DECIMAL(5,2) DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    arrived_at TIMESTAMPTZ,
    wait_started_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS price_settings (
    id SERIAL PRIMARY KEY,
    price_per_km DECIMAL(12,2) DEFAULT 2000,
    price_per_minute_wait DECIMAL(12,2) DEFAULT 500,
    free_wait_minutes INTEGER DEFAULT 2,
    service_fee DECIMAL(12,2) DEFAULT 2000,
    surge_multiplier DECIMAL(5,2) DEFAULT 1.0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS surge_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_multiplier DECIMAL(5,2) NOT NULL,
    start_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 10 AND duration_minutes <= 120),
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('up', 'down')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Peak periods: single entry defines a complete surge cycle (rise → peak → fall)
CREATE TABLE IF NOT EXISTS peak_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    peak_multiplier DECIMAL(5,2) NOT NULL CHECK (peak_multiplier > 1.0 AND peak_multiplier <= 5.0),
    rise_minutes  INTEGER NOT NULL CHECK (rise_minutes  >= 1),
    fall_minutes  INTEGER NOT NULL CHECK (fall_minutes  >= 1),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hourly surge: 24 rows (0-23), each with a multiplier. Yandex-style simple pricing.
CREATE TABLE IF NOT EXISTS hourly_surge (
    hour INTEGER PRIMARY KEY CHECK (hour >= 0 AND hour <= 23),
    multiplier DECIMAL(5,2) NOT NULL DEFAULT 1.0 CHECK (multiplier >= 0.5 AND multiplier <= 5.0)
);
-- Seed all 24 hours with default x1.0
INSERT INTO hourly_surge (hour, multiplier)
SELECT h, 1.0 FROM generate_series(0, 23) AS h
ON CONFLICT (hour) DO NOTHING;

-- base_surge_multiplier: the live multiplier restores to this value outside peak periods
ALTER TABLE price_settings ADD COLUMN IF NOT EXISTS base_surge_multiplier DECIMAL(5,2) DEFAULT 1.0;

-- trip_type: 'standard' (pickup+dest) or 'free' (meter, no dest required)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trip_type VARCHAR(20) DEFAULT 'standard';
-- Allow free-tariff orders without a destination
ALTER TABLE orders ALTER COLUMN destination_lat DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN destination_lng DROP NOT NULL;
-- Lock price_per_km (with surge) at order creation so admin changes don't affect in-flight orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS locked_price_per_km DECIMAL(12,2) DEFAULT 0;

INSERT INTO price_settings (price_per_km, price_per_minute_wait, free_wait_minutes, service_fee, surge_multiplier)
SELECT 2000, 500, 2, 2000, 1.0
WHERE NOT EXISTS (SELECT 1 FROM price_settings);

INSERT INTO admins (phone, password_hash, access_token)
SELECT
    '+998914751330',
    crypt('Supreme001', gen_salt('bf', 12)),
    'Ax3nt1sAdm2026T0k3n7'
WHERE NOT EXISTS (SELECT 1 FROM admins WHERE phone = '+998914751330');

-- Admin role: 'superadmin' has full access, other roles see only their section
-- Possible values: 'superadmin', 'dispatcher', 'orders', 'revenue', 'pricing', 'users', 'referrals'
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role VARCHAR(30) DEFAULT 'superadmin';
-- Set superadmin role for the seed admin
UPDATE admins SET role = 'superadmin' WHERE phone = '+998914751330' AND (role IS NULL OR role = '');

-- Royal Taxi Mode: new columns and tables (additive only, never alters existing behaviour)

-- order_type: 'app' (passenger-initiated) | 'call' (dispatcher-initiated)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(10) DEFAULT 'app';
-- pricing_type: 'yandex' (service_fee + km) | 'royal' (pure per-100m meter)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pricing_type VARCHAR(10) DEFAULT 'yandex';
-- dispatcher_phone: passenger phone entered by dispatcher for call orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatcher_phone VARCHAR(30);
-- royal_price_per_km: rate locked at order creation for royal orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS royal_price_per_km DECIMAL(12,2) DEFAULT 0;

-- Global taxi mode setting (one row, always present)
CREATE TABLE IF NOT EXISTS taxi_mode (
    id SERIAL PRIMARY KEY,
    mode VARCHAR(10) NOT NULL DEFAULT 'yandex' CHECK (mode IN ('yandex', 'royal')),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO taxi_mode (mode) SELECT 'yandex' WHERE NOT EXISTS (SELECT 1 FROM taxi_mode);

-- Royal pricing settings (separate from Yandex price_settings)
ALTER TABLE price_settings ADD COLUMN IF NOT EXISTS royal_price_per_km DECIMAL(12,2) DEFAULT 3000;

-- Driver ratings: one rating per completed order (passenger rates driver)
CREATE TABLE IF NOT EXISTS ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    passenger_id UUID REFERENCES users(id) ON DELETE CASCADE,
    rating DECIMAL(2,1) NOT NULL CHECK (rating >= 1.0 AND rating <= 5.0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (order_id)
);

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS average_rating DECIMAL(3,2) DEFAULT 5.0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0;

-- passenger_phone: direct phone storage for call orders (no ghost user needed)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS passenger_phone VARCHAR(30);

-- Indexes for fast order history queries
CREATE INDEX IF NOT EXISTS idx_orders_passenger_id_created ON orders (passenger_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_driver_id_created ON orders (driver_id, created_at DESC);

-- PINFL column — kept for backward compatibility, no longer used
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pinfl VARCHAR(20) DEFAULT '';

-- Driver verification workflow and registration documents
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS registration_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS reviewed_by_admin_id UUID REFERENCES admins(id);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS review_comment TEXT DEFAULT '';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS selfie_url VARCHAR(500) DEFAULT '';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS license_front_url VARCHAR(500) DEFAULT '';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS license_back_url VARCHAR(500) DEFAULT '';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS id_document_url VARCHAR(500) DEFAULT '';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS id_document_back_url VARCHAR(500) DEFAULT '';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS car_brand VARCHAR(100) DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_drivers_registration_status ON drivers (registration_status);

-- 7-digit unique referral code assigned to each driver on registration
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS referral_code VARCHAR(7);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_referral_code ON drivers (referral_code) WHERE referral_code IS NOT NULL;

-- The referral code the driver entered (who referred them)
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS referred_by VARCHAR(7);

-- Which referral benefit the driver chose: 'commission' (lower %) or 'bonus' (weekly cash)
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS referral_benefit_type VARCHAR(12);

-- Balance: sum accumulated via completed rides (before commission deduction)
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS balance DECIMAL(14,2) DEFAULT 0;

-- Referral program settings (single row)
CREATE TABLE IF NOT EXISTS referral_settings (
    id SERIAL PRIMARY KEY,
    default_commission_pct  DECIMAL(5,2) DEFAULT 8.0,
    reduced_commission_pct  DECIMAL(5,2) DEFAULT 6.0,
    weekly_bonus_amount     DECIMAL(14,2) DEFAULT 10000,
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO referral_settings (default_commission_pct, reduced_commission_pct, weekly_bonus_amount)
SELECT 8.0, 6.0, 10000
WHERE NOT EXISTS (SELECT 1 FROM referral_settings);

-- Scheduled weekly bonuses given to drivers who chose the bonus benefit
CREATE TABLE IF NOT EXISTS referral_bonuses (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id  UUID REFERENCES drivers(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    amount     DECIMAL(14,2) NOT NULL,
    paid_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_bonuses_driver_week ON referral_bonuses (driver_id, week_start);

-- Additional info for call orders (landmarks, street details)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS additional_info TEXT DEFAULT '';

-- Quiz scores: each ride session can produce one quiz result per passenger
CREATE TABLE IF NOT EXISTS quiz_scores (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
    score       INTEGER NOT NULL DEFAULT 0,
    total_questions INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    played_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quiz_scores_user_id ON quiz_scores (user_id, played_at DESC);

-- Driver friends / social network
CREATE TABLE IF NOT EXISTS driver_friends (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    status       VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(requester_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_driver_friends_recipient ON driver_friends (recipient_id, status);

-- Cashback % for the 'cashback' benefit type
ALTER TABLE referral_settings ADD COLUMN IF NOT EXISTS cashback_pct DECIMAL(5,2) DEFAULT 10.0;

-- Driver lifetime stats for milestones and streaks
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lifetime_trips INTEGER DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS streak_days INTEGER DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_trip_date DATE;

-- General bonus program settings (night, streak, milestones)
CREATE TABLE IF NOT EXISTS bonus_settings (
    id                   SERIAL PRIMARY KEY,
    night_bonus_pct      DECIMAL(5,2)  DEFAULT 15.0,
    night_bonus_enabled  BOOLEAN       DEFAULT false,
    streak_days_required INTEGER       DEFAULT 7,
    streak_bonus_amount  DECIMAL(14,2) DEFAULT 50000,
    streak_bonus_enabled BOOLEAN       DEFAULT false,
    milestone_50_amount  DECIMAL(14,2) DEFAULT 25000,
    milestone_100_amount DECIMAL(14,2) DEFAULT 50000,
    milestone_500_amount DECIMAL(14,2) DEFAULT 200000,
    milestone_1000_amount DECIMAL(14,2) DEFAULT 500000,
    milestones_enabled   BOOLEAN       DEFAULT false,
    updated_at           TIMESTAMPTZ   DEFAULT NOW()
);
INSERT INTO bonus_settings (updated_at)
SELECT NOW()
WHERE NOT EXISTS (SELECT 1 FROM bonus_settings);

-- Per-trip cashback records
CREATE TABLE IF NOT EXISTS cashback_transactions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id  UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    order_id   UUID REFERENCES orders(id) ON DELETE SET NULL,
    amount     DECIMAL(14,2) NOT NULL,
    pct        DECIMAL(5,2)  NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cashback_driver ON cashback_transactions (driver_id, created_at DESC);

-- All bonus payouts: streaks, milestones, night bonuses, etc.
CREATE TABLE IF NOT EXISTS driver_bonus_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id   UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    bonus_type  VARCHAR(50) NOT NULL,
    amount      DECIMAL(14,2) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bonus_events_driver ON driver_bonus_events (driver_id, created_at DESC);

-- Auto-cancel stuck orders older than 2 hours in non-terminal states
UPDATE orders SET status = 'cancelled', cancelled_at = NOW()
WHERE status IN ('searching', 'queued', 'accepted', 'arrived', 'in_progress')
  AND created_at < NOW() - INTERVAL '2 hours';

-- Approve existing drivers that have NULL or empty registration_status
-- (drivers created before the registration workflow was added)
UPDATE drivers SET registration_status = 'approved'
WHERE registration_status IS NULL OR registration_status = '';

-- One-time cleanup: delete all old test data so system starts fresh
-- Uses a flag table to ensure this only runs ONCE (not on every restart)
CREATE TABLE IF NOT EXISTS _migration_flags (key TEXT PRIMARY KEY, done_at TIMESTAMPTZ DEFAULT NOW());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = 'cleanup_v1') THEN
    DELETE FROM quiz_scores;
    DELETE FROM cashback_transactions;
    DELETE FROM driver_bonus_events;
    DELETE FROM referral_bonuses;
    DELETE FROM driver_friends;
    DELETE FROM ratings;
    DELETE FROM orders;
    DELETE FROM drivers;
    DELETE FROM users;
    INSERT INTO _migration_flags (key) VALUES ('cleanup_v1');
  END IF;
END $$;

-- Ban system: temporary or permanent ban with reason
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT DEFAULT '';

-- Persistent service share percentage (admin sets in Revenue panel)
ALTER TABLE price_settings ADD COLUMN IF NOT EXISTS service_share_pct DECIMAL(5,2) DEFAULT 10.0;

-- Weekly bonus (Yandex-style progressive challenge): 7 weeks with configurable trips & amounts
ALTER TABLE bonus_settings ADD COLUMN IF NOT EXISTS weekly_bonus_enabled BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS weekly_bonus_tiers (
    week_number INTEGER PRIMARY KEY CHECK (week_number >= 1 AND week_number <= 7),
    required_trips INTEGER NOT NULL DEFAULT 50,
    bonus_amount DECIMAL(14,2) NOT NULL DEFAULT 50000
);
-- Seed default 7 tiers (progressive: 50→100→150→200→250→300→400 trips)
INSERT INTO weekly_bonus_tiers (week_number, required_trips, bonus_amount)
VALUES (1,50,100000),(2,100,150000),(3,150,200000),(4,200,250000),(5,250,300000),(6,300,350000),(7,400,500000)
ON CONFLICT (week_number) DO NOTHING;

-- Per-driver weekly progress tracker
CREATE TABLE IF NOT EXISTS driver_weekly_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    week_number INTEGER NOT NULL DEFAULT 1 CHECK (week_number >= 1 AND week_number <= 7),
    trips_completed INTEGER NOT NULL DEFAULT 0,
    bonus_paid BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(driver_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_driver_weekly_progress ON driver_weekly_progress (driver_id, week_start DESC);

-- Driver balance system: exempt flag (free drivers skip balance check)
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS balance_exempt BOOLEAN DEFAULT false;

-- Balance transactions log (top-ups, commission deductions, bonuses, admin adjustments)
CREATE TABLE IF NOT EXISTS balance_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    amount DECIMAL(14,2) NOT NULL,
    tx_type VARCHAR(30) NOT NULL CHECK (tx_type IN ('top_up','commission','bonus','admin_adjustment')),
    description TEXT DEFAULT '',
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_balance_tx_driver ON balance_transactions (driver_id, created_at DESC);

-- Saved payment cards (demo — no real payment provider)
CREATE TABLE IF NOT EXISTS driver_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    card_number VARCHAR(19) NOT NULL,
    card_holder VARCHAR(100) DEFAULT '',
    expiry VARCHAR(5) NOT NULL,
    card_type VARCHAR(20) DEFAULT 'unknown',
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_cards ON driver_cards (driver_id);
`

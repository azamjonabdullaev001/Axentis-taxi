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

-- base_surge_multiplier: the live multiplier restores to this value outside peak periods
ALTER TABLE price_settings ADD COLUMN IF NOT EXISTS base_surge_multiplier DECIMAL(5,2) DEFAULT 1.0;

INSERT INTO price_settings (price_per_km, price_per_minute_wait, free_wait_minutes, service_fee, surge_multiplier)
SELECT 2000, 500, 2, 2000, 1.0
WHERE NOT EXISTS (SELECT 1 FROM price_settings);

INSERT INTO admins (phone, password_hash, access_token)
SELECT
    '+998914751330',
    crypt('Supreme001', gen_salt('bf', 12)),
    'Ax3nt1sAdm2026T0k3n7'
WHERE NOT EXISTS (SELECT 1 FROM admins WHERE phone = '+998914751330');
`

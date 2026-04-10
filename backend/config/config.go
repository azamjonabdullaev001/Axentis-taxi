package config

import "os"

type Config struct {
	DatabaseURL string
	JWTSecret   string
	Port        string
	OSRMURL     string
}

func Load() *Config {
	return &Config{
		DatabaseURL: getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/axentis_taxi?sslmode=disable"),
		JWTSecret:   getEnv("JWT_SECRET", "axentis_taxi_super_secret_key_2026"),
		Port:        getEnv("PORT", "8080"),
		OSRMURL:     getEnv("OSRM_URL", "http://localhost:5000"),
	}
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

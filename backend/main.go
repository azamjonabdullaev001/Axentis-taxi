package main

import (
	"log"
	"os"

	"axentis-taxi/config"
	"axentis-taxi/database"
	"axentis-taxi/handlers"
	"axentis-taxi/middleware"
	"axentis-taxi/services"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	cfg := config.Load()

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	if err := database.RunMigrations(db); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	hub := services.NewHub()
	go hub.Run()

	pricingService := services.NewPricingService(db)
	go pricingService.StartSurgeScheduler()

	pushService := services.NewPushService(db)

	r := gin.Default()

	// Serve uploaded avatars publicly
	r.Static("/uploads", "./uploads")

	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
	}))

	authHandler := handlers.NewAuthHandler(db, cfg)
	orderHandler := handlers.NewOrderHandler(db, hub, pricingService, pushService)
	adminHandler := handlers.NewAdminHandlerFull(db, cfg, pricingService, hub, pushService)
	wsHandler := handlers.NewWSHandler(hub, db)

	api := r.Group("/api/v1")
	{
		auth := api.Group("/auth")
		{
			auth.POST("/register/passenger", authHandler.RegisterPassenger)
			auth.POST("/register/driver", authHandler.RegisterDriver)
			auth.POST("/login", authHandler.Login)
		}

		protected := api.Group("/")
		protected.Use(middleware.JWTAuth(cfg.JWTSecret))
		{
			protected.GET("/profile", authHandler.GetProfile)
			protected.PUT("/profile", authHandler.UpdateProfile)
			protected.POST("/upload/avatar", authHandler.UploadAvatar)
			protected.PUT("/push-token", authHandler.SavePushToken)
			protected.GET("/drivers/locations", orderHandler.GetAvailableDrivers)

			protected.POST("/orders", orderHandler.CreateOrder)
			protected.GET("/orders/:id", orderHandler.GetOrder)
			protected.GET("/orders/history", orderHandler.GetOrderHistory)
			protected.POST("/orders/:id/accept", orderHandler.AcceptOrder)
			protected.POST("/orders/:id/decline", orderHandler.DeclineOrder)
			protected.POST("/orders/:id/arrived", orderHandler.DriverArrived)
			protected.POST("/orders/:id/start", orderHandler.StartTrip)
			protected.POST("/orders/:id/complete", orderHandler.CompleteOrder)
			protected.POST("/orders/:id/cancel", orderHandler.CancelOrder)
			protected.PUT("/orders/:id/distance", orderHandler.UpdateOrderDistance)
			protected.POST("/orders/:id/rate", orderHandler.RateDriver)
			protected.GET("/driver/ratings", orderHandler.GetDriverRatings)

			protected.PUT("/driver/location", orderHandler.UpdateDriverLocation)
			protected.PUT("/driver/availability", orderHandler.UpdateDriverAvailability)
			protected.PUT("/passenger/location", orderHandler.UpdatePassengerLocation)
			protected.PUT("/passenger/location-sharing", orderHandler.UpdatePassengerLocationSharing)

			// Referral
			protected.POST("/referral/apply", authHandler.ApplyReferral)
		}

		adminAPI := api.Group("/admin")
		adminAPI.Use(middleware.AdminAuth(cfg.JWTSecret))
		{
			adminAPI.GET("/orders", adminHandler.GetAllOrders)
			adminAPI.GET("/revenue", adminHandler.GetRevenue)
			adminAPI.GET("/users", adminHandler.GetUsers)
			adminAPI.POST("/admins", adminHandler.CreateAdmin)
			adminAPI.GET("/admins", adminHandler.GetAdmins)
			adminAPI.GET("/pricing", adminHandler.GetPricingSettings)
			adminAPI.PUT("/pricing", adminHandler.UpdatePricingSettings)
			adminAPI.GET("/surge-schedules", adminHandler.GetSurgeSchedules)
			adminAPI.POST("/surge-schedules", adminHandler.CreateSurgeSchedule)
			adminAPI.DELETE("/surge-schedules/:id", adminHandler.DeleteSurgeSchedule)
			adminAPI.GET("/peak-periods", adminHandler.GetPeakPeriods)
			adminAPI.POST("/peak-periods", adminHandler.CreatePeakPeriod)
			adminAPI.DELETE("/peak-periods/:id", adminHandler.DeletePeakPeriod)
			adminAPI.POST("/call-orders", adminHandler.CreateCallOrder)

			// Driver management
			adminAPI.POST("/drivers", adminHandler.CreateDriver)
			adminAPI.GET("/drivers/:id/analytics", adminHandler.GetDriverAnalytics)

			// Referral program
			adminAPI.GET("/referral-settings", adminHandler.GetReferralSettings)
			adminAPI.PUT("/referral-settings", adminHandler.UpdateReferralSettings)
			adminAPI.GET("/referrals", adminHandler.GetReferrals)
		}

		api.POST("/admin/login", adminHandler.Login)
		// Public routes — no auth required (used by passenger app)
		api.GET("/pricing/settings", adminHandler.GetPricingSettings)

	}

	r.GET("/ws", wsHandler.Handle)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Axentis Taxi Backend starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

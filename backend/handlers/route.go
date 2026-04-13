package handlers

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"axentis-taxi/config"

	"github.com/gin-gonic/gin"
)

type RouteHandler struct {
	osrmURL string
	client  *http.Client
}

func NewRouteHandler(cfg *config.Config) *RouteHandler {
	return &RouteHandler{
		osrmURL: cfg.OSRMURL,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// GetRoute proxies a routing request to the internal OSRM server.
// GET /api/v1/route?pickup_lat=...&pickup_lng=...&dest_lat=...&dest_lng=...
func (h *RouteHandler) GetRoute(c *gin.Context) {
	pickupLat, err1 := strconv.ParseFloat(c.Query("pickup_lat"), 64)
	pickupLng, err2 := strconv.ParseFloat(c.Query("pickup_lng"), 64)
	destLat, err3 := strconv.ParseFloat(c.Query("dest_lat"), 64)
	destLng, err4 := strconv.ParseFloat(c.Query("dest_lng"), 64)

	if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid coordinates"})
		return
	}

	// Validate coordinate ranges
	if pickupLat < -90 || pickupLat > 90 || destLat < -90 || destLat > 90 ||
		pickupLng < -180 || pickupLng > 180 || destLng < -180 || destLng > 180 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "coordinates out of range"})
		return
	}

	osrmURL := fmt.Sprintf(
		"%s/route/v1/driving/%f,%f;%f,%f?overview=full&geometries=geojson&steps=true&continue_straight=true&radiuses=30;30",
		h.osrmURL, pickupLng, pickupLat, destLng, destLat,
	)

	resp, err := h.client.Get(osrmURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "routing service unavailable"})
		return
	}
	defer resp.Body.Close()

	c.Header("Content-Type", "application/json")
	c.Status(resp.StatusCode)
	io.Copy(c.Writer, resp.Body)
}

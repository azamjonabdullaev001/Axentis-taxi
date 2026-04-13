package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
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
		"%s/route/v1/driving/%f,%f;%f,%f?overview=full&geometries=geojson&steps=true&continue_straight=true&radiuses=50;50",
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

// MatchRoute snaps a sequence of coordinates onto the road network using OSRM match.
// POST /api/v1/route/match   body: { "coordinates": [[lng,lat], ...] }
// Returns the matched geometry that hugs the roads precisely.
func (h *RouteHandler) MatchRoute(c *gin.Context) {
	var req struct {
		Coordinates [][]float64 `json:"coordinates"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Coordinates) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "need at least 2 coordinates"})
		return
	}

	// Limit to 100 points max (OSRM default limit)
	coords := req.Coordinates
	if len(coords) > 100 {
		// Sample evenly
		sampled := make([][]float64, 0, 100)
		step := float64(len(coords)-1) / 99.0
		for i := 0; i < 99; i++ {
			sampled = append(sampled, coords[int(float64(i)*step)])
		}
		sampled = append(sampled, coords[len(coords)-1])
		coords = sampled
	}

	// Build OSRM match URL: /match/v1/driving/lng,lat;lng,lat;...
	parts := make([]string, len(coords))
	radiuses := make([]string, len(coords))
	for i, pt := range coords {
		if len(pt) < 2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "each coordinate must be [lng, lat]"})
			return
		}
		parts[i] = fmt.Sprintf("%f,%f", pt[0], pt[1])
		radiuses[i] = "25" // tight snap: 25m radius per point
	}

	osrmURL := fmt.Sprintf(
		"%s/match/v1/driving/%s?overview=full&geometries=geojson&radiuses=%s",
		h.osrmURL, strings.Join(parts, ";"), strings.Join(radiuses, ";"),
	)

	resp, err := h.client.Get(osrmURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "match service unavailable"})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	// Parse to extract matched geometry
	var result struct {
		Code       string `json:"code"`
		Matchings  []struct {
			Geometry json.RawMessage `json:"geometry"`
		} `json:"matchings"`
	}
	if err := json.Unmarshal(body, &result); err != nil || result.Code != "Ok" || len(result.Matchings) == 0 {
		// Return original coordinates if match fails
		c.JSON(http.StatusOK, gin.H{"code": "NoMatch", "coordinates": req.Coordinates})
		return
	}

	// Return the matched geometry from the first (and usually only) matching
	c.JSON(http.StatusOK, gin.H{
		"code":     "Ok",
		"geometry": result.Matchings[0].Geometry,
	})
}

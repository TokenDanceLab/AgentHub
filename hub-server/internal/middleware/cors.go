package middleware

import (
	"os"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func CORS() gin.HandlerFunc {
	origins := os.Getenv("AGENTHUB_CORS_ORIGINS")
	if origins == "" {
		origins = "*"
	}
	return cors.New(cors.Config{
		AllowOrigins:     []string{origins},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Request-ID"},
		ExposeHeaders:    []string{"X-Request-ID", "Retry-After"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	})
}

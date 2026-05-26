package service

import (
	"context"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/agenthub/hub-server/internal/config"
)

// NewS3StorageFromConfig creates an S3Storage backed by the real AWS SDK v2.
func NewS3StorageFromConfig(ctx context.Context, cfg config.S3Config) (*S3Storage, error) {
	region := cfg.Region
	if region == "" {
		region = "us-east-1"
	}

	resolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, options ...interface{}) (aws.Endpoint, error) {
		return aws.Endpoint{
			URL:               cfg.Endpoint,
			SigningRegion:     region,
			HostnameImmutable: true,
		}, nil
	})

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, "")),
		awsconfig.WithEndpointResolverWithOptions(resolver),
	)
	if err != nil {
		return nil, fmt.Errorf("s3: failed to load aws config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = true
	})

	return NewS3Storage(
		func(ctx context.Context, bucket, key string, body io.Reader, contentType string) error {
			_, err := client.PutObject(ctx, &s3.PutObjectInput{
				Bucket:      aws.String(bucket),
				Key:         aws.String(key),
				Body:        body,
				ContentType: aws.String(contentType),
			})
			return err
		},
		func(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
			out, err := client.GetObject(ctx, &s3.GetObjectInput{
				Bucket: aws.String(bucket),
				Key:    aws.String(key),
			})
			if err != nil {
				return nil, err
			}
			return out.Body, nil
		},
		func(ctx context.Context, bucket, key string) error {
			_, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket: aws.String(bucket),
				Key:    aws.String(key),
			})
			return err
		},
		cfg.Bucket,
	), nil
}

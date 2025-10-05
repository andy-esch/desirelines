// Package storage provides Cloud Storage operations for the API Gateway.
package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"cloud.google.com/go/storage"
)

// ErrNotFound is returned when a blob is not found.
var ErrNotFound = errors.New("blob not found")

// Client defines the interface for storage operations.
type Client interface {
	ReadJSON(ctx context.Context, blobPath string) (interface{}, error)
}

// CloudStorageClient implements Client using Google Cloud Storage.
type CloudStorageClient struct {
	client     *storage.Client
	bucketName string
}

// NewCloudStorageClient creates a new Cloud Storage client.
func NewCloudStorageClient(ctx context.Context) (*CloudStorageClient, error) {
	bucketName := os.Getenv("GCP_BUCKET_NAME")
	if bucketName == "" {
		return nil, fmt.Errorf("GCP_BUCKET_NAME environment variable not set")
	}

	client, err := storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create storage client: %w", err)
	}

	return &CloudStorageClient{
		client:     client,
		bucketName: bucketName,
	}, nil
}

// ReadJSON reads a JSON blob from Cloud Storage and returns parsed data.
func (c *CloudStorageClient) ReadJSON(ctx context.Context, blobPath string) (interface{}, error) {
	bucket := c.client.Bucket(c.bucketName)
	obj := bucket.Object(blobPath)

	reader, err := obj.NewReader(ctx)
	if err != nil {
		if errors.Is(err, storage.ErrObjectNotExist) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to read object %s: %w", blobPath, err)
	}
	defer func() {
		if closeErr := reader.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("failed to close reader: %w", closeErr)
		}
	}()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read blob contents: %w", err)
	}

	var result interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %w", err)
	}

	return result, nil
}

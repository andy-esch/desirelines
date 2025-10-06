package storage

import (
	"context"
	"testing"
)

// MockStorageClient is a mock implementation of the Client interface for testing.
type MockStorageClient struct {
	ReadJSONFunc func(ctx context.Context, blobPath string) (interface{}, error)
}

func (m *MockStorageClient) ReadJSON(ctx context.Context, blobPath string) (interface{}, error) {
	if m.ReadJSONFunc != nil {
		return m.ReadJSONFunc(ctx, blobPath)
	}
	return nil, ErrNotFound
}

func TestMockStorageClient(t *testing.T) {
	ctx := context.Background()

	t.Run("returns mock data", func(t *testing.T) {
		mockData := map[string]interface{}{"test": "data"}
		mock := &MockStorageClient{
			ReadJSONFunc: func(ctx context.Context, blobPath string) (interface{}, error) {
				return mockData, nil
			},
		}

		result, err := mock.ReadJSON(ctx, "test/path.json")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		data, ok := result.(map[string]interface{})
		if !ok {
			t.Fatal("expected map[string]interface{}")
		}

		if data["test"] != "data" {
			t.Errorf("expected 'data', got %v", data["test"])
		}
	})

	t.Run("returns ErrNotFound when not configured", func(t *testing.T) {
		mock := &MockStorageClient{}

		_, err := mock.ReadJSON(ctx, "test/path.json")
		if err != ErrNotFound {
			t.Errorf("expected ErrNotFound, got %v", err)
		}
	})
}

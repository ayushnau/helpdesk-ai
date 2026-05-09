# Acme API Quickstart

## Authentication

All API requests require a Bearer token. Get your API key from **Settings → API Keys** in the dashboard.

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api.acme.com/v1/products
```

## Base URL

```
https://api.acme.com/v1
```

## Core Endpoints

### List Products
```
GET /v1/products
```
Returns all products in your catalog. Supports pagination with `?page=1&limit=20`.

### Create Order
```
POST /v1/orders
Content-Type: application/json

{
  "product_id": "prod_abc123",
  "quantity": 2,
  "shipping_address": {
    "line1": "123 Main St",
    "city": "San Francisco",
    "state": "CA",
    "zip": "94102"
  }
}
```

### Get Order Status
```
GET /v1/orders/:id
```
Returns the current status: `pending`, `processing`, `shipped`, or `delivered`.

## Rate Limits

- **Free tier**: 100 requests/minute
- **Pro tier**: 1,000 requests/minute
- **Enterprise**: Unlimited

Rate limit headers are included in every response:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1699900000
```

## Error Handling

All errors return a consistent JSON format:
```json
{
  "error": {
    "code": "invalid_api_key",
    "message": "The API key provided is expired or invalid."
  }
}
```

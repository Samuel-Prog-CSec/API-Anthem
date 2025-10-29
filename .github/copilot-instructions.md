# API REST - Node.js Express MongoDB

This is a professional REST API built with Node.js, Express.js, and MongoDB, featuring JWT authentication and comprehensive security measures.

## Project Structure
- **controllers/**: Business logic for handling requests
- **models/**: MongoDB schemas and data models
- **constants/**: Application-wide constants
- **routes/**: API endpoint definitions
- **middleware/**: Security and validation middleware
- **utils/**: Helper functions and utilities
- **config/**: Configuration files and logger setup

## Technologies
### Core Stack
- Node.js (v22.19.0+) & Express.js v5.1
- MongoDB with Mongoose ODM v8.8+
- JWT authentication with refresh tokens

### Security & Validation
- bcryptjs for password hashing
- helmet for security headers
- express-rate-limit for API throttling
- express-mongo-sanitize for NoSQL injection prevention
- express-validator for request validation
- xss for XSS protection

### Performance & Monitoring
- node-cache for in-memory caching
- Pino & Pino-HTTP for structured logging
- pino-pretty for development logging

### Development Tools
- nodemon for hot-reload
- ESLint v9 for code quality
- Custom analysis scripts (analyze.js)

## Security Features
- JWT-based authentication
- Password hashing with bcrypt
- NoSQL injection prevention
- Rate limiting
- CORS configuration
- Input validation and sanitization
- Security headers with helmet
- Environment variable protection

## Development Guidelines
### Code Style & Standards
- Use MVC architecture with strict separation of concerns
- Controllers coordinate HTTP requests (max ~400-500 lines)
- Business logic belongs in Model static methods
- Follow clean code principles and DRY
- Use TypeScript-like JSDoc comments for documentation
- Apply security best practices (XSS, NoSQL injection, rate limiting)

### Performance & Optimization
- Use queryHelper.buildFilters() for MongoDB query construction
- Apply constants from src/constants/index.js
- Implement caching with node-cache (TTL based on data volatility)
- Add .lean() to read-only queries for ~40% memory reduction
- Ensure proper MongoDB indexes for frequent queries

### Code Organization Patterns
- Use utils/queryHelper.js for query construction (eliminates ~420 lines)
- Use utils/paginationHelper.js for consistent pagination
- Centralize constants in src/constants/index.js
- Move complex aggregations to Model static methods
- Keep controllers focused on HTTP coordination

### Maintainability Rules
- NO emojis in code, comments, or API messages
- Code in English, comments/logs/API responses (or documentation) in Spanish
- Use Pino logger instead of console.log/error/warn
- Write clear commit messages in Spanish
- Document complex business logic in JSDoc

## Data
### Data Sources
- Raw data location: `datos_hpe/` directory
- Format: CSV files with static Smart City data
- Documentation: `docs/dataset_information.md`
### Data Models
- Mongoose models with comprehensive schemas
- Validation at schema level and route level
- Indexes optimized for frequent query patterns
- GeoJSON support for geospatial queries
### Import Process
- Script: `scripts/importAll.js`
- Individual importers in `scripts/importation/`
- Uses Mongoose models for data validation
- Batch processing for large datasets
- Error handling and logging during import

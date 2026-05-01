// Augment Express Request with the decoded JWT payload attached by requireAuth

declare namespace Express {
  interface Request {
    user?: import('../middlewares/authMiddleware').JwtPayload;
  }
}

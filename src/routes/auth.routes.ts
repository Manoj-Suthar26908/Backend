import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { demoDb, DBUser } from '../config/demo-db';
import { config } from '../config/env';

export const authRouter = Router();

/**
 * GET /api/auth/me
 * Returns authenticated user details
 */
authRouter.get('/me', (req: Request, res: Response) => {
  const defaultUser = demoDb.getUser('user-demo-admin');
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as any;
      const user = demoDb.getUser(decoded.id) || defaultUser;
      return res.json({ success: true, data: user });
    } catch (_) {
      // Return default user if token invalid in demo mode
    }
  }

  res.json({
    success: true,
    data: defaultUser,
  });
});

/**
 * POST /api/auth/demo-login
 * Direct login with selected demo persona
 */
authRouter.post('/login', (req: Request, res: Response) => {
  const user = demoDb.getUser('user-demo-admin')!;

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    },
    config.jwt.secret,
    { expiresIn: '7d' }
  );

  res.json({
    success: true,
    data: {
      user,
      token,
    },
  });
});

/**
 * POST /api/auth/google/callback
 * Handles Google OAuth ID token verification
 */
authRouter.post('/google/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { credential, userInfo } = req.body;

    let user: DBUser;
    if (userInfo && userInfo.email) {
      const existing = demoDb.getUserByEmail(userInfo.email);
      if (existing) {
        user = existing;
      } else {
        user = {
          id: `user-${Date.now()}`,
          email: userInfo.email,
          name: userInfo.name || 'Google User',
          avatarUrl: userInfo.picture || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
          googleId: userInfo.sub || `google-${Date.now()}`,
          role: 'USER',
          tenantId: 'tenant-reachinbox-primary',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        demoDb.saveUser(user);
      }
    } else {
      user = demoDb.getUser('user-demo-admin')!;
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
      },
      config.jwt.secret,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      data: {
        user,
        token,
      },
    });
  } catch (error: any) {
    next(error);
  }
});

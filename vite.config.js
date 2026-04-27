import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/selfig/' : '/',
  publicDir: 'public',
  server: {
    port: 3000,
  },
  plugins: [
    {
      name: 'serve-data',
      configureServer(server) {
        // Serve data/ directory files during development
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/data/')) {
            const filePath = join(process.cwd(), req.url);
            if (existsSync(filePath)) {
              const content = readFileSync(filePath);
              if (filePath.endsWith('.json')) {
                res.setHeader('Content-Type', 'application/json');
              } else if (filePath.endsWith('.webp')) {
                res.setHeader('Content-Type', 'image/webp');
              }
              res.end(content);
              return;
            }
          }
          next();
        });
      },
    },
  ],
});

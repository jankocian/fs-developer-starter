import * as esbuild from 'esbuild';
import { sassPlugin } from 'esbuild-sass-plugin';
import { readdirSync } from 'fs';
import fs from 'fs/promises';
import { copyFile, mkdir } from 'fs/promises';
import { join, sep } from 'path';
import path from 'path';
import { fileURLToPath } from 'url';

// Config output
const BUILD_DIRECTORY = 'dist';
const PRODUCTION = process.env.NODE_ENV === 'production';

// Config entrypoint files
const ENTRY_POINTS = ['src/index.ts'];

// Config dev serving
const LIVE_RELOAD = !PRODUCTION;
const SERVE_PORT = 3000;
const SERVE_ORIGIN = `http://localhost:${SERVE_PORT}`;

// Plugin to generate package.json in the dist directory
const generatePackageJsonPlugin = () => {
  return {
    name: 'generate-dist-package-json',
    setup(build) {
      build.onEnd(async () => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const rootDir = path.resolve(__dirname, '..');
        const distDir = path.join(rootDir, BUILD_DIRECTORY);

        try {
          const packageJsonContent = await fs.readFile(path.join(rootDir, 'package.json'), 'utf-8');
          const packageJson = JSON.parse(packageJsonContent);

          // Modify the package.json as needed
          delete packageJson.scripts;
          delete packageJson.devDependencies;
          delete packageJson.files;
          delete packageJson.publishConfig;
          packageJson.browser = 'index.js'; // Update as per your entry file

          // Write the modified package.json to the dist directory
          await fs.writeFile(
            path.join(distDir, 'package.json'),
            JSON.stringify(packageJson, null, 2)
          );
          console.log('package.json generated in dist directory');
        } catch (error) {
          console.error('Error generating package.json:', error);
        }
      });
    },
  };
};

// Plugin to copy README.md to the dist directory
const copyReadmePlugin = () => {
  return {
    name: 'copy-readme-to-dist',
    setup(build) {
      build.onEnd(() => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const rootDir = path.resolve(__dirname, '..');
        const distDir = path.join(rootDir, BUILD_DIRECTORY);

        fs.copyFile(path.join(rootDir, 'README.md'), path.join(distDir, 'README.md'))
          .then(() => console.log('README.md copied to dist directory'))
          .catch((error) => console.error('Error copying README.md:', error));
      });
    },
  };
};

// New plugin to copy public directory contents to dist
const copyPublicPlugin = () => {
  return {
    name: 'copy-public-to-dist',
    setup(build) {
      build.onEnd(async () => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const rootDir = path.resolve(__dirname, '..');
        const publicDir = path.join(rootDir, 'public');
        const distDir = path.join(rootDir, BUILD_DIRECTORY);

        try {
          // Check if the public directory exists
          const publicDirExists = await fs
            .access(publicDir)
            .then(() => true)
            .catch(() => false);

          if (publicDirExists) {
            const copyRecursive = async (src, dest) => {
              const entries = await fs.readdir(src, { withFileTypes: true });
              await mkdir(dest, { recursive: true });

              for (let entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);

                if (entry.isDirectory()) {
                  await copyRecursive(srcPath, destPath);
                } else {
                  await copyFile(srcPath, destPath);
                }
              }
            };

            await copyRecursive(publicDir, distDir);
            console.log('Public directory contents copied to dist directory');
          } else {
            console.log('Public directory does not exist. Skipping copy operation.');
          }
        } catch (error) {
          console.error('Error in copyPublicPlugin:', error);
        }
      });
    },
  };
};

// Create context
const context = await esbuild.context({
  bundle: true,
  entryPoints: ENTRY_POINTS,
  outdir: BUILD_DIRECTORY,
  minify: PRODUCTION,
  sourcemap: !PRODUCTION,
  target: PRODUCTION ? 'es2020' : 'esnext',
  inject: LIVE_RELOAD ? ['./bin/live-reload.js'] : undefined,
  plugins: [
    sassPlugin(),
    copyPublicPlugin(),
    ...(PRODUCTION ? [generatePackageJsonPlugin(), copyReadmePlugin()] : []),
  ],
  define: {
    SERVE_ORIGIN: JSON.stringify(SERVE_ORIGIN),
  },
});

// Build files in prod
if (PRODUCTION) {
  await context.rebuild();
  context.dispose();
}

// Watch and serve files in dev
else {
  await context.watch();
  await context
    .serve({
      servedir: BUILD_DIRECTORY,
      port: SERVE_PORT,
    })
    .then(logServedFiles);
}

/**
 * Logs information about the files that are being served during local development.
 */
function logServedFiles() {
  /**
   * Recursively gets all files in a directory.
   * @param {string} dirPath
   * @returns {string[]} An array of file paths.
   */
  const getFiles = (dirPath) => {
    const files = readdirSync(dirPath, { withFileTypes: true }).map((dirent) => {
      const path = join(dirPath, dirent.name);
      return dirent.isDirectory() ? getFiles(path) : path;
    });

    return files.flat();
  };

  const files = getFiles(BUILD_DIRECTORY);

  const filesInfo = files
    .map((file) => {
      if (file.endsWith('.map')) return;

      // Normalize path and create file location
      const paths = file.split(sep);
      paths[0] = SERVE_ORIGIN;

      const location = paths.join('/');

      // Create import suggestion
      const tag = location.endsWith('.css')
        ? `<link href="${location}" rel="stylesheet" type="text/css"/>`
        : `<script defer src="${location}"></script>`;

      return {
        'File Location': location,
        'Import Suggestion': tag,
      };
    })
    .filter(Boolean);

  // eslint-disable-next-line no-console
  console.table(filesInfo);
}

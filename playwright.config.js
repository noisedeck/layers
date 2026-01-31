import { defineConfig } from 'playwright/test'

export default defineConfig({
    testDir: './tests',
    timeout: 30000,
    use: {
        baseURL: 'http://localhost:3002',
        headless: true,
    },
    webServer: {
        command: 'npx http-server public -p 3002 -c-1',
        port: 3002,
        reuseExistingServer: true,
    },
})

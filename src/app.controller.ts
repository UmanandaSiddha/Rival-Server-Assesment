import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Get()
    getHello(): string {
        return this.appService.getHello();
    }

    // Liveness probe for Docker/uptime checks (public, no auth). → GET /api/v1/health
    @Get('health')
    health() {
        return { status: 'ok' };
    }
}

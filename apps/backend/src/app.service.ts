import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello() {
    return { message: 'Welcome to the Wanderlust VTT API' };
  }

  getHealth() {
    return { status: 'ok' };
  }
}

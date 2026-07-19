import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello() {
    return { message: 'Welcome to the AI RPG World Builder API' };
  }

  getHealth() {
    return { status: 'ok' };
  }
}

import { BadRequestException, Controller, Delete, NotFoundException, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { existsSync, unlinkSync } from 'fs';
import { basename, join } from 'path';
import { storeImage, uploadDirectory } from './upload-storage';

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const extensions: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

@Controller('api/uploads')
export class UploadsController {
  @Post('images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  uploadImage(@UploadedFile() file: UploadedImage) {
    if (!file || !extensions[file.mimetype]) {
      throw new BadRequestException('Upload a PNG, JPEG, GIF, or WebP image.');
    }
    return storeImage(file.buffer, extensions[file.mimetype]);
  }

  @Delete('images/:filename')
  deleteImage(@Param('filename') requestedFilename: string) {
    const filename = basename(requestedFilename);
    if (filename !== requestedFilename) throw new BadRequestException('Invalid filename.');
    const path = join(uploadDirectory, filename);
    if (!existsSync(path)) throw new NotFoundException('Image not found.');
    unlinkSync(path);
    return { deleted: true };
  }
}

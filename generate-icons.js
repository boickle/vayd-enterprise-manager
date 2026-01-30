import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Allow custom input file via command line argument, or use default
const inputFileName = process.argv[2] || 'vayd_icon.png';
const inputImage = join(__dirname, 'public', inputFileName);
const outputDir = join(__dirname, 'public');

// Icon sizes needed
const iconSizes = [32, 120, 152, 180, 192, 512];

async function generateIcons() {
  // Check if input image exists
  if (!existsSync(inputImage)) {
    console.error(`❌ Input image not found: ${inputImage}`);
    console.error(`\nUsage: npm run generate-icons [filename]`);
    console.error(`Example: npm run generate-icons your-logo.png`);
    console.error(`\nIf no filename is provided, it will use: vayd_icon.png`);
    process.exit(1);
  }
  
  console.log(`📸 Using input image: ${inputFileName}\n`);

  console.log('🖼️  Generating app icons...\n');

  try {
    // Load the input image
    const image = sharp(inputImage);

    // Generate each icon size
    for (const size of iconSizes) {
      const outputPath = join(outputDir, `icon-${size}.png`);
      
      await image
        .resize(size, size, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 } // White background
        })
        .png()
        .toFile(outputPath);
      
      console.log(`✅ Generated icon-${size}.png (${size}x${size})`);
    }

    console.log('\n✨ All icons generated successfully!');
    console.log('\n📱 Next steps:');
    console.log('1. Rebuild your app (npm run build)');
    console.log('2. Clear your iPhone\'s Safari cache');
    console.log('3. Remove the old app from your home screen');
    console.log('4. Add it to home screen again to see the new icon');
  } catch (error) {
    console.error('❌ Error generating icons:', error.message);
    process.exit(1);
  }
}

generateIcons();

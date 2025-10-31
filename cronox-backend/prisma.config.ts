import 'dotenv/config';
import { join } from 'path';

// fuerza carga del .env desde la raíz del backend
process.env.DOTENV_PATH = join(__dirname, '.env');

// no hace falta exportar nada, solo cargar dotenv

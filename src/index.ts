import { config } from './config';
import { logger } from './logger';
import app from './app';

app.listen(config.port, () => {
  logger.info(`BioWatchCare API démarré sur le port ${config.port} (${config.nodeEnv})`);
});

/*
 * Copyright (c) 2020 The Ontario Institute for Cancer Research. All rights reserved
 *
 * This program and the accompanying materials are made available under the terms of
 * the GNU Affero General Public License v3.0. You should have received a copy of the
 * GNU Affero General Public License along with this program.
 *  If not, see <http://www.gnu.org/licenses/>.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
 * SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
 * ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import bodyParser from 'body-parser';
import * as swaggerUi from 'swagger-ui-express';
import path from 'path';
import yaml from 'yamljs';
import { AppConfig } from './config';
import Auth from '@overture-stack/ego-token-middleware';
import log from './logger';
import logger from './logger';
import * as svc from './service';
import { Errors } from './service';
console.log('in App.ts');
const App = (config: AppConfig): express.Express => {
  // Auth middleware
  const noOpReqHandler: RequestHandler = (req, res, next) => {
    log.warn('calling protected endpoint without auth enabled');
    next();
  };
  const authFilter = config.auth.enabled
    ? Auth(config.auth.jwtKeyUrl, config.auth.jwtKey)
    : (scope: string[]) => {
        return noOpReqHandler;
      };

  const app = express();
  app.set('port', config.serverPort);
  app.use(bodyParser.json());

  app.get('/', (req, res) => res.status(200).send('Data Centers Registry'));

  app.get('/health', (req, res) => {
    const status = dbHealth.status == Status.OK ? 200 : 500;
    const resBody = {
      db: dbHealth,
      version: `${process.env.npm_package_version || process.env.SVC_VERSION} - ${
        process.env.SVC_COMMIT_ID
      }`,
    };
    return res.status(status).send(resBody);
  });

  const authHandler = authFilter([config.auth.WRITE_SCOPE]);

  app.get(
    '/data-centers/:centerId',
    wrapAsync(async (req: Request, res: Response) => {
      const result = await svc.byId(req.params.centerId);
      return res.status(200).send(result);
    }),
  );

  app.post(
    '/data-centers/search',
    wrapAsync(async (req: Request, res: Response) => {
      const query = req.body;
      const result = await svc.advSearchByQuery(query);
      return res.status(200).send(result);
    }),
  );

  app.get(
    '/data-centers',
    wrapAsync(async (req: Request, res: Response) => {
      const filters: svc.QueryFilters = {
        country: (req.query.country as string)?.split(',') || [],
        name: (req.query.name as string)?.split(',') || [],
        centerId: (req.query.centerId as string)?.split(',') || [],
        type: (req.query.type as string)?.split(',') || [],
      };
      const result = await svc.getMany(filters);
      return res.status(200).send(result);
    }),
  );

  app.post(
    '/data-centers',
    authHandler,
    wrapAsync(async (req: Request, res: Response) => {
      const dc = req.body;
      const result = await svc.create(dc);
      return res.send(result).status(201);
    }),
  );

  app.put(
    '/data-centers',
    authHandler,
    wrapAsync(async (req: Request, res: Response) => {
      const dc = req.body;
      const result = await svc.update(dc);
      return res.send(result).status(200);
    }),
  );

  app.delete(
    '/data-centers/:centerId',
    authHandler,
    wrapAsync(async (req: Request, res: Response) => {
      await svc.deleteDc(req.params.centerId);
      return res.status(204).send();
    }),
  );

  app.use(
    config.openApiPath,
    swaggerUi.serve,
    swaggerUi.setup(yaml.load(path.join(__dirname, './resources/swagger.yaml'))),
  );

  app.use(errorHandler);
  return app;
};

export const wrapAsync = (fn: RequestHandler): RequestHandler => {
  return (req, res, next) => {
    const routePromise = fn(req, res, next);
    if (routePromise.catch) {
      routePromise.catch(next);
    }
  };
};

// general catch all error handler
export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction): any => {
  logger.error('error handler received error: ', err);
  if (res.headersSent) {
    logger.debug('error handler skipped');
    return next(err);
  }
  let status: number;
  let customizableMsg = err.message;

  switch (true) {
    case err.name == 'Unauthorized':
      status = 401;
      break;
    case err.name == 'Forbidden':
      status = 403;
      break;
    case err instanceof Errors.InvalidArgument:
      status = 400;
      break;
    case err instanceof Errors.NotFound:
      err.name = 'Not found';
      status = 404;
      break;
    case err instanceof Errors.StateConflict:
      status = 409;
      break;
    case (err as any).name == 'CastError':
      status = 404;
      err.name = 'Not found';
      customizableMsg = 'Id not found';
      break;
    default:
      status = 500;
  }
  res.status(status).send({ error: err.name, message: customizableMsg });
  next(err);
};

export enum Status {
  OK = '😇',
  UNKNOWN = '🤔',
  ERROR = '😱',
}

export const dbHealth = {
  status: Status.UNKNOWN,
  stautsText: 'N/A',
};

export function setDBStatus(status: Status) {
  if (status == Status.OK) {
    dbHealth.status = Status.OK;
    dbHealth.stautsText = 'OK';
  }
  if (status == Status.UNKNOWN) {
    dbHealth.status = Status.UNKNOWN;
    dbHealth.stautsText = 'UNKNOWN';
  }
  if (status == Status.ERROR) {
    dbHealth.status = Status.ERROR;
    dbHealth.stautsText = 'ERROR';
  }
}

export default App;

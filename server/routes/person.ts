import type TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbPersonCreditCast,
  TmdbPersonCreditCrew,
} from '@server/api/themoviedb/interfaces';
import Media from '@server/entity/Media';
import logger from '@server/logger';
import {
  mapCastCredits,
  mapCrewCredits,
  mapPersonDetails,
} from '@server/models/Person';
import { Router } from 'express';
import { createTmdbWithRegionLanguage } from './discover';

/**
 * Filter person credits by certification-based content ratings
 * Similar to filterResultsByRating in search.ts but for person credits
 * @param credits - Array of person credits (cast or crew)
 * @param tmdb - TheMovieDb instance with user's rating preferences
 * @returns Promise of filtered credits using certification data
 */
const filterCreditsByRating = async <
  T extends TmdbPersonCreditCast | TmdbPersonCreditCrew
>(
  credits: T[],
  tmdb: TheMovieDb
): Promise<T[]> => {
  // Separate credits by media type for proper certification filtering
  const movieCredits = credits.filter(
    (credit) => credit.media_type === 'movie'
  );
  const tvCredits = credits.filter((credit) => credit.media_type === 'tv');
  const otherCredits = credits.filter(
    (credit) => credit.media_type !== 'movie' && credit.media_type !== 'tv'
  );

  // Apply certification-based filtering using TheMovieDb methods
  // These methods accept any object with an 'id' field, so we can pass person credits
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filteredMovies = await tmdb.filterMoviesByCertification(
    movieCredits as any
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filteredTv = await tmdb.filterTvByRating(tvCredits as any);

  // Combine filtered results, maintaining original order as much as possible
  return [...filteredMovies, ...filteredTv, ...otherCredits] as T[];
};

const personRoutes = Router();

personRoutes.get('/:id', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const person = await tmdb.getPerson({
      personId: Number(req.params.id),
      language: (req.query.language as string) ?? req.locale,
    });
    return res.status(200).json(mapPersonDetails(person));
  } catch (e) {
    logger.debug('Something went wrong retrieving person', {
      label: 'API',
      errorMessage: e.message,
      personId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve person.',
    });
  }
});

personRoutes.get('/:id/combined_credits', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const combinedCredits = await tmdb.getPersonCombinedCredits({
      personId: Number(req.params.id),
      language: (req.query.language as string) ?? req.locale,
    });

    // Apply certification-based content filtering to person credits
    const filteredCast = await filterCreditsByRating(
      combinedCredits.cast,
      tmdb
    );
    const filteredCrew = await filterCreditsByRating(
      combinedCredits.crew,
      tmdb
    );

    const castMedia = await Media.getRelatedMedia(
      filteredCast.map((result) => result.id)
    );

    const crewMedia = await Media.getRelatedMedia(
      filteredCrew.map((result) => result.id)
    );

    return res.status(200).json({
      cast: filteredCast
        .map((result) =>
          mapCastCredits(
            result,
            castMedia.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === result.media_type
            )
          )
        )
        .filter((item) => !item.adult),
      crew: filteredCrew
        .map((result) =>
          mapCrewCredits(
            result,
            crewMedia.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === result.media_type
            )
          )
        )
        .filter((item) => !item.adult),
      id: combinedCredits.id,
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving combined credits', {
      label: 'API',
      errorMessage: e.message,
      personId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve combined credits.',
    });
  }
});

export default personRoutes;

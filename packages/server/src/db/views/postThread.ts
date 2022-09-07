import { PostThreadView } from '@adxp/microblog'
import { DataSource } from 'typeorm'
import { PostIndex } from '../records/post'
import { ProfileIndex } from '../records/profile'
import { UserDid } from '../user-dids'
import schemas from '../schemas'
import * as util from '../util'
import { DbViewPlugin } from '../types'
import { LikeIndex } from '../records/like'
import { RepostIndex } from '../records/repost'
import { AdxRecord } from '../record'

const viewId = 'blueskyweb.xyz:PostThreadView'
const validator = schemas.createViewValidator(viewId)
const validParams = (obj: unknown): obj is PostThreadView.Params => {
  return validator.isParamsValid(obj)
}

export const viewFn =
  (db: DataSource) =>
  async (
    params: unknown,
    requester: string,
  ): Promise<PostThreadView.Response> => {
    if (!validParams(params)) {
      throw new Error(`Invalid params for ${viewId}`)
    }

    const { uri, depth = 1 } = params

    const res = await postInfoBuilder(db, requester)
      .where('post.uri = :uri', {
        uri,
      })
      .getRawOne()

    let thread = rowToPost(res)
    if (depth > 0) {
      thread.replies = await getReplies(db, thread, depth - 1, requester)
    }

    thread = setParents(thread)

    return { thread }
  }

const getReplies = async (
  db: DataSource,
  parent: PostThreadView.Post,
  depth: number,
  requester: string,
): Promise<PostThreadView.Post[]> => {
  const res = await postInfoBuilder(db, requester)
    .where('post.replyParent = :uri', { uri: parent.uri })
    .getRawMany()
  return Promise.all(
    res.map(async (row) => {
      const post = rowToPost(row, parent)
      if (depth > 0) {
        post.replies = await getReplies(db, post, depth - 1, requester)
      }
      return post
    }),
  )
}

// selects all the needed info about a post, just need to supply the `where` clause
const postInfoBuilder = (db: DataSource, requester: string) => {
  return db
    .createQueryBuilder()
    .select([
      'post.uri AS uri',
      'author.did AS authorDid',
      'author.username AS authorName',
      'author_profile.displayName AS authorDisplayName',
      'record.raw AS rawRecord',
      'reply_count.count AS replyCount',
      'like_count.count AS likeCount',
      'repost_count.count AS repostCount',
      'record.indexedAt AS indexedAt',
      'requester_repost.doesExist AS requesterHasReposted',
      'requester_like.doesExist AS requesterHasLiked',
    ])
    .from(PostIndex, 'post')
    .innerJoin(AdxRecord, 'record', 'record.uri = post.uri')
    .innerJoin(UserDid, 'author', 'author.did = post.creator')
    .leftJoin(ProfileIndex, 'author_profile', 'author.did = post.creator')
    .leftJoin(
      util.countSubquery(LikeIndex, 'subject'),
      'like_count',
      'like_count.subject = post.uri',
    )
    .leftJoin(
      util.countSubquery(RepostIndex, 'subject'),
      'repost_count',
      'repost_count.subject = post.uri',
    )
    .leftJoin(
      util.countSubquery(PostIndex, 'replyParent'),
      'reply_count',
      'reply_count.subject = post.uri',
    )
    .leftJoin(
      util.existsByCreatorSubquery(RepostIndex, 'subject', requester),
      'requester_repost',
      'requester_repost.subject = post.uri',
    )
    .leftJoin(
      util.existsByCreatorSubquery(LikeIndex, 'subject', requester),
      'requester_like',
      'requester_like.subject = post.uri',
    )
}

// converts the raw SQL output to a Post object
// unfortunately not type-checked since we're dealing with raw SQL, so change with caution!
const rowToPost = (
  row: any,
  parent?: PostThreadView.Post,
): PostThreadView.Post => {
  return {
    uri: row.uri,
    author: {
      did: row.authorDid,
      name: row.authorName,
      displayName: row.authorDisplayName,
    },
    record: JSON.parse(row.rawRecord),
    parent,
    replyCount: row.replyCount,
    likeCount: row.likeCount,
    repostCount: row.repostCount,
    indexedAt: row.indexedAt,
    myState: {
      hasReposted: row.requesterHasReposted,
      hasLiked: row.requesterHasLiked,
    },
  }
}

// parents were set without replies set yet, so we recurse back through updating the parent
const setParents = (
  root: PostThreadView.Post,
  parent?: PostThreadView.Post,
) => {
  const updatedRoot = {
    ...root,
    parent,
  }
  return {
    ...updatedRoot,
    replies: updatedRoot.replies
      ? updatedRoot.replies.map((reply) => setParents(reply, updatedRoot))
      : undefined,
  }
}

const plugin: DbViewPlugin = {
  id: viewId,
  fn: viewFn,
}

export default plugin

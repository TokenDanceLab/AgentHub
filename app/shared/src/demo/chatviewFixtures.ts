/**
 * Chatview fixtures public barrel — TranscriptBlock[] for demo conversations.
 * Residual pure-helper peel of chatviewFixtures (#1132). Pure only; zero behavior change.
 *
 * Implementations live in domain companions; this file re-exports so
 * workbenchDemo imports from `./chatviewFixtures` remain stable.
 */

export { chatviewBuilderTranscript } from './chatviewFixturesBuilder'
export { chatviewAgentCollabTranscript } from './chatviewFixturesCollab'
export { chatviewAnnouncementTranscript } from './chatviewFixturesAnnouncement'

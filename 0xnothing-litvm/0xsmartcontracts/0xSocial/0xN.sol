// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

interface IERC721Owner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract ZeroxN {
    uint256 public constant MAX_USERNAME_LENGTH = 24;
    uint256 public constant MIN_USERNAME_LENGTH = 3;
    uint256 public constant MAX_DISPLAY_LENGTH = 48;
    uint256 public constant MAX_BIO_LENGTH = 240;
    uint256 public constant MAX_POST_LENGTH = 720;
    uint256 public constant MAX_COMMENT_LENGTH = 360;
    uint256 public constant MAX_MESSAGE_LENGTH = 720;
    uint256 public constant MAX_ENCRYPTED_BYTES = 4096;
    uint256 public constant MAX_SLUG_LENGTH = 32;
    uint256 public constant MAX_RANK_LENGTH = 32;
    address public constant DEFAULT_NUSD = 0xF2d0fd65d9f62D57255AF6350f807E6c11A4CFdb;
    address public constant DEFAULT_PIXEL = 0x33A32b9b2BEe864f9e42BFa39cA7BDC72f655988;

    address public owner;
    address public pendingOwner;
    address public NUSD;
    address public pixel;
    bool public paused;

    uint256 public minVerifiedPostLikes = 10000;
    uint256 public minVerifiedFollowers = 1000;
    uint256 public minVerifiedNUSDBalance = 1000 ether;

    uint256 public postCount;
    uint256 public commentCount;
    uint256 public channelCount;
    uint256 public groupCount;
    uint256 public messageCount;

    struct Profile {
        string username;
        string displayName;
        string bio;
        uint256 avatarTokenId;
        bool avatarEnabled;
        bool exists;
        bool adminVerified;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct Post {
        address author;
        uint256 channelId;
        uint256 pixelTokenId;
        string content;
        uint64 createdAt;
        uint32 likeCount;
        uint32 commentCount;
        bool hasPixel;
        bool deleted;
    }

    struct Comment {
        uint256 postId;
        address author;
        uint256 pixelTokenId;
        string content;
        uint64 createdAt;
        bool hasPixel;
        bool deleted;
    }

    struct Channel {
        address creator;
        string slug;
        string name;
        string description;
        uint64 createdAt;
        uint32 memberCount;
        bool active;
    }

    struct Group {
        address creator;
        string name;
        string description;
        uint64 createdAt;
        uint32 memberCount;
        uint32 messageCount;
        bool active;
    }

    struct Message {
        address from;
        address to;
        uint256 groupId;
        string content;
        bytes encryptedPayload;
        uint64 createdAt;
        uint8 kind;
        bool deleted;
    }

    mapping(address => Profile) public profiles;
    mapping(bytes32 => address) public usernameOwner;
    mapping(address => bool) public moderators;

    mapping(uint256 => Post) public posts;
    mapping(uint256 => Comment) public comments;
    mapping(uint256 => Channel) public channels;
    mapping(bytes32 => uint256) public channelBySlug;
    mapping(uint256 => Group) public groups;
    mapping(uint256 => Message) public messages;

    mapping(address => uint256[]) private _userPosts;
    mapping(uint256 => uint256[]) private _channelPosts;
    mapping(uint256 => uint256[]) private _postComments;
    mapping(uint256 => uint256[]) private _groupMessages;
    mapping(address => uint256[]) private _inbox;
    mapping(address => uint256[]) private _sent;
    uint256[] private _globalMessages;

    mapping(uint256 => mapping(address => bool)) public likedPost;
    mapping(address => mapping(address => bool)) public following;
    mapping(address => uint256) public followerCount;
    mapping(address => uint256) public followingCount;
    mapping(address => uint256) public maxPostLikes;

    mapping(uint256 => mapping(address => bool)) public channelMember;
    mapping(uint256 => mapping(address => uint64)) public channelJoinedAt;

    mapping(uint256 => mapping(address => bool)) public groupMember;
    mapping(uint256 => mapping(address => bool)) public groupAdmin;
    mapping(uint256 => mapping(address => bool)) public groupOfficer;
    mapping(uint256 => mapping(address => string)) public groupRankName;
    mapping(uint256 => mapping(address => uint64)) public groupJoinedAt;
    mapping(uint256 => mapping(address => bytes)) public groupKeyEnvelope;

    event ProfileCreated(address indexed user, string username);
    event ProfileUpdated(address indexed user);
    event UsernameChanged(address indexed user, string oldUsername, string newUsername);
    event AdminVerified(address indexed user, bool verified);
    event PostCreated(uint256 indexed postId, address indexed author, uint256 indexed channelId, uint256 pixelTokenId);
    event PostDeleted(uint256 indexed postId);
    event PostLiked(uint256 indexed postId, address indexed user, address indexed author, uint256 likeCount);
    event CommentCreated(uint256 indexed commentId, uint256 indexed postId, address indexed author);
    event CommentDeleted(uint256 indexed commentId);
    event Followed(address indexed follower, address indexed target);
    event Unfollowed(address indexed follower, address indexed target);
    event ChannelCreated(uint256 indexed channelId, string slug, address indexed creator);
    event ChannelJoined(uint256 indexed channelId, address indexed user);
    event ChannelLeft(uint256 indexed channelId, address indexed user);
    event ChannelStatusUpdated(uint256 indexed channelId, bool active);
    event GroupCreated(uint256 indexed groupId, address indexed creator);
    event GroupMemberAdded(uint256 indexed groupId, address indexed member, address indexed addedBy);
    event GroupMemberRemoved(uint256 indexed groupId, address indexed member, address indexed removedBy);
    event GroupAdminUpdated(uint256 indexed groupId, address indexed admin, bool enabled);
    event GroupOfficerUpdated(uint256 indexed groupId, address indexed officer, bool enabled, string rankName);
    event GroupKeyEnvelopeUpdated(uint256 indexed groupId, address indexed member);
    event GroupStatusUpdated(uint256 indexed groupId, bool active);
    event MessageSent(uint256 indexed messageId, uint8 indexed kind, address indexed from, address to, uint256 groupId);
    event MessageDeleted(uint256 indexed messageId);
    event ModeratorUpdated(address indexed moderator, bool enabled);
    event IntegrationsUpdated(address indexed nusd, address indexed pixel);
    event VerificationRulesUpdated(uint256 minPostLikes, uint256 minFollowers, uint256 minNUSDBalance);
    event Paused(bool paused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == owner || moderators[msg.sender]);
        _;
    }

    modifier whenNotPaused() {
        require(!paused);
        _;
    }

    modifier onlyProfile() {
        require(profiles[msg.sender].exists);
        _;
    }

    modifier onlyGroupAdmin(uint256 groupId) {
        require(groups[groupId].active);
        require(groupAdmin[groupId][msg.sender]);
        _;
    }

    modifier onlyGroupStaff(uint256 groupId) {
        require(groups[groupId].active);
        require(groupAdmin[groupId][msg.sender] || groupOfficer[groupId][msg.sender]);
        _;
    }

    constructor() {
        owner = msg.sender;
        NUSD = DEFAULT_NUSD;
        pixel = DEFAULT_PIXEL;
        emit OwnershipTransferred(address(0), msg.sender);
        emit IntegrationsUpdated(DEFAULT_NUSD, DEFAULT_PIXEL);
    }

    function registerProfile(
        string calldata username,
        string calldata displayName_,
        string calldata bio,
        bool avatarEnabled,
        uint256 avatarTokenId
    ) external whenNotPaused {
        require(!profiles[msg.sender].exists);
        bytes32 nameHash = _validateUsername(username);
        require(usernameOwner[nameHash] == address(0));
        _validateText(displayName_, MAX_DISPLAY_LENGTH, false);
        _validateText(bio, MAX_BIO_LENGTH, false);
        if (avatarEnabled) _requirePixelOwner(avatarTokenId, msg.sender);

        profiles[msg.sender] = Profile({
            username: username,
            displayName: displayName_,
            bio: bio,
            avatarTokenId: avatarTokenId,
            avatarEnabled: avatarEnabled,
            exists: true,
            adminVerified: false,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp)
        });
        usernameOwner[nameHash] = msg.sender;
        emit ProfileCreated(msg.sender, username);
    }

    function updateProfile(
        string calldata displayName_,
        string calldata bio,
        bool avatarEnabled,
        uint256 avatarTokenId
    ) external whenNotPaused onlyProfile {
        _validateText(displayName_, MAX_DISPLAY_LENGTH, false);
        _validateText(bio, MAX_BIO_LENGTH, false);
        if (avatarEnabled) _requirePixelOwner(avatarTokenId, msg.sender);

        Profile storage profile = profiles[msg.sender];
        profile.displayName = displayName_;
        profile.bio = bio;
        profile.avatarEnabled = avatarEnabled;
        profile.avatarTokenId = avatarTokenId;
        profile.updatedAt = uint64(block.timestamp);
        emit ProfileUpdated(msg.sender);
    }

    function changeUsername(string calldata newUsername) external whenNotPaused onlyProfile {
        bytes32 newHash = _validateUsername(newUsername);
        address current = usernameOwner[newHash];
        require(current == address(0) || current == msg.sender);

        Profile storage profile = profiles[msg.sender];
        string memory oldUsername = profile.username;
        bytes32 oldHash = keccak256(bytes(oldUsername));
        if (usernameOwner[oldHash] == msg.sender) delete usernameOwner[oldHash];

        usernameOwner[newHash] = msg.sender;
        profile.username = newUsername;
        profile.updatedAt = uint64(block.timestamp);
        emit UsernameChanged(msg.sender, oldUsername, newUsername);
    }

    function createPost(
        string calldata content,
        bool hasPixel,
        uint256 pixelTokenId
    ) external whenNotPaused onlyProfile returns (uint256 postId) {
        postId = _createPost(0, content, hasPixel, pixelTokenId);
    }

    function createChannel(
        string calldata slug,
        string calldata name,
        string calldata description
    ) external whenNotPaused onlyProfile returns (uint256 channelId) {
        bytes32 slugHash = _validateSlug(slug);
        require(channelBySlug[slugHash] == 0);
        _validateText(name, MAX_DISPLAY_LENGTH, true);
        _validateText(description, MAX_BIO_LENGTH, false);

        unchecked {
            ++channelCount;
        }
        channelId = channelCount;
        channels[channelId] = Channel({
            creator: msg.sender,
            slug: slug,
            name: name,
            description: description,
            createdAt: uint64(block.timestamp),
            memberCount: 1,
            active: true
        });
        channelBySlug[slugHash] = channelId;
        channelMember[channelId][msg.sender] = true;
        channelJoinedAt[channelId][msg.sender] = uint64(block.timestamp);

        emit ChannelCreated(channelId, slug, msg.sender);
        emit ChannelJoined(channelId, msg.sender);
    }

    function joinChannel(uint256 channelId) external whenNotPaused onlyProfile {
        Channel storage channel = channels[channelId];
        require(channel.active);
        require(!channelMember[channelId][msg.sender]);
        channelMember[channelId][msg.sender] = true;
        channelJoinedAt[channelId][msg.sender] = uint64(block.timestamp);
        channel.memberCount += 1;
        emit ChannelJoined(channelId, msg.sender);
    }

    function leaveChannel(uint256 channelId) external whenNotPaused {
        Channel storage channel = channels[channelId];
        require(channel.active);
        require(channel.creator != msg.sender);
        require(channelMember[channelId][msg.sender]);
        channelMember[channelId][msg.sender] = false;
        channelJoinedAt[channelId][msg.sender] = 0;
        channel.memberCount -= 1;
        emit ChannelLeft(channelId, msg.sender);
    }

    function postToChannel(
        uint256 channelId,
        string calldata content,
        bool hasPixel,
        uint256 pixelTokenId
    ) external whenNotPaused onlyProfile returns (uint256 postId) {
        require(channels[channelId].active);
        require(channelMember[channelId][msg.sender]);
        postId = _createPost(channelId, content, hasPixel, pixelTokenId);
        _channelPosts[channelId].push(postId);
    }

    function commentOnPost(
        uint256 postId,
        string calldata content,
        bool hasPixel,
        uint256 pixelTokenId
    ) external whenNotPaused onlyProfile returns (uint256 commentId) {
        Post storage postData = posts[postId];
        require(postData.author != address(0) && !postData.deleted);
        if (postData.channelId != 0) {
            require(channelMember[postData.channelId][msg.sender]);
        }
        _validateText(content, MAX_COMMENT_LENGTH, true);
        if (hasPixel) _requirePixelOwner(pixelTokenId, msg.sender);

        unchecked {
            ++commentCount;
        }
        commentId = commentCount;
        comments[commentId] = Comment({
            postId: postId,
            author: msg.sender,
            pixelTokenId: pixelTokenId,
            content: content,
            createdAt: uint64(block.timestamp),
            hasPixel: hasPixel,
            deleted: false
        });
        _postComments[postId].push(commentId);
        postData.commentCount += 1;
        emit CommentCreated(commentId, postId, msg.sender);
    }

    function likePost(uint256 postId) external whenNotPaused onlyProfile {
        Post storage postData = posts[postId];
        require(postData.author != address(0) && !postData.deleted);
        if (postData.channelId != 0) {
            require(channelMember[postData.channelId][msg.sender]);
        }
        require(!likedPost[postId][msg.sender]);
        likedPost[postId][msg.sender] = true;
        postData.likeCount += 1;
        if (postData.likeCount > maxPostLikes[postData.author]) {
            maxPostLikes[postData.author] = postData.likeCount;
        }
        emit PostLiked(postId, msg.sender, postData.author, postData.likeCount);
    }

    function follow(address target) external whenNotPaused onlyProfile {
        require(target != msg.sender && profiles[target].exists);
        require(!following[msg.sender][target]);
        following[msg.sender][target] = true;
        followingCount[msg.sender] += 1;
        followerCount[target] += 1;
        emit Followed(msg.sender, target);
    }

    function unfollow(address target) external whenNotPaused {
        require(following[msg.sender][target]);
        following[msg.sender][target] = false;
        followingCount[msg.sender] -= 1;
        followerCount[target] -= 1;
        emit Unfollowed(msg.sender, target);
    }

    function createGroup(
        string calldata name,
        string calldata description,
        bytes calldata creatorKeyEnvelope
    ) external whenNotPaused onlyProfile returns (uint256 groupId) {
        _validateText(name, MAX_DISPLAY_LENGTH, true);
        _validateText(description, MAX_BIO_LENGTH, false);
        _validateEncrypted(creatorKeyEnvelope);

        unchecked {
            ++groupCount;
        }
        groupId = groupCount;
        groups[groupId] = Group({
            creator: msg.sender,
            name: name,
            description: description,
            createdAt: uint64(block.timestamp),
            memberCount: 1,
            messageCount: 0,
            active: true
        });

        groupMember[groupId][msg.sender] = true;
        groupAdmin[groupId][msg.sender] = true;
        groupJoinedAt[groupId][msg.sender] = uint64(block.timestamp);
        groupKeyEnvelope[groupId][msg.sender] = creatorKeyEnvelope;

        emit GroupCreated(groupId, msg.sender);
        emit GroupMemberAdded(groupId, msg.sender, msg.sender);
        emit GroupAdminUpdated(groupId, msg.sender, true);
        emit GroupKeyEnvelopeUpdated(groupId, msg.sender);
    }

    function addGroupMember(
        uint256 groupId,
        address member,
        bytes calldata keyEnvelope
    ) external whenNotPaused onlyGroupStaff(groupId) {
        require(member != address(0) && profiles[member].exists);
        require(!groupMember[groupId][member]);
        _validateEncrypted(keyEnvelope);

        groupMember[groupId][member] = true;
        groupJoinedAt[groupId][member] = uint64(block.timestamp);
        groupKeyEnvelope[groupId][member] = keyEnvelope;
        groups[groupId].memberCount += 1;

        emit GroupMemberAdded(groupId, member, msg.sender);
        emit GroupKeyEnvelopeUpdated(groupId, member);
    }

    function removeGroupMember(uint256 groupId, address member)
        external
        whenNotPaused
        onlyGroupAdmin(groupId)
    {
        require(member != address(0));
        require(member != groups[groupId].creator);
        require(groupMember[groupId][member]);
        if (groupAdmin[groupId][member]) {
            require(groups[groupId].creator == msg.sender);
        }

        groupMember[groupId][member] = false;
        groupAdmin[groupId][member] = false;
        groupOfficer[groupId][member] = false;
        groupJoinedAt[groupId][member] = 0;
        delete groupRankName[groupId][member];
        delete groupKeyEnvelope[groupId][member];
        groups[groupId].memberCount -= 1;

        emit GroupMemberRemoved(groupId, member, msg.sender);
        emit GroupAdminUpdated(groupId, member, false);
        emit GroupOfficerUpdated(groupId, member, false, "");
    }

    function leaveGroup(uint256 groupId) external whenNotPaused {
        Group storage groupData = groups[groupId];
        require(groupData.active);
        require(groupData.creator != msg.sender);
        require(groupMember[groupId][msg.sender]);

        groupMember[groupId][msg.sender] = false;
        groupAdmin[groupId][msg.sender] = false;
        groupOfficer[groupId][msg.sender] = false;
        groupJoinedAt[groupId][msg.sender] = 0;
        delete groupRankName[groupId][msg.sender];
        delete groupKeyEnvelope[groupId][msg.sender];
        groupData.memberCount -= 1;

        emit GroupMemberRemoved(groupId, msg.sender, msg.sender);
        emit GroupAdminUpdated(groupId, msg.sender, false);
        emit GroupOfficerUpdated(groupId, msg.sender, false, "");
    }

    function setGroupAdmin(uint256 groupId, address admin, bool enabled)
        external
        whenNotPaused
    {
        require(groups[groupId].active);
        require(groups[groupId].creator == msg.sender);
        require(groupMember[groupId][admin]);
        groupAdmin[groupId][admin] = enabled;
        if (enabled) {
            groupOfficer[groupId][admin] = false;
            delete groupRankName[groupId][admin];
            emit GroupOfficerUpdated(groupId, admin, false, "");
        }
        emit GroupAdminUpdated(groupId, admin, enabled);
    }

    function setGroupOfficer(
        uint256 groupId,
        address officer,
        bool enabled,
        string calldata rankName
    ) external whenNotPaused {
        require(groups[groupId].active);
        require(groups[groupId].creator == msg.sender);
        require(groupMember[groupId][officer]);
        require(!groupAdmin[groupId][officer]);
        if (enabled) {
            _validateText(rankName, MAX_RANK_LENGTH, true);
            groupRankName[groupId][officer] = rankName;
        } else {
            delete groupRankName[groupId][officer];
        }
        groupOfficer[groupId][officer] = enabled;
        emit GroupOfficerUpdated(groupId, officer, enabled, enabled ? rankName : "");
    }

    function setGroupKeyEnvelope(
        uint256 groupId,
        address member,
        bytes calldata keyEnvelope
    ) external whenNotPaused onlyGroupAdmin(groupId) {
        require(groupMember[groupId][member]);
        _validateEncrypted(keyEnvelope);
        groupKeyEnvelope[groupId][member] = keyEnvelope;
        emit GroupKeyEnvelopeUpdated(groupId, member);
    }

    function sendPublicMessage(string calldata content)
        external
        whenNotPaused
        onlyProfile
        returns (uint256 messageId)
    {
        _validateText(content, MAX_MESSAGE_LENGTH, true);
        messageId = _storeMessage({
            from: msg.sender,
            to: address(0),
            groupId: 0,
            content: content,
            encryptedPayload: "",
            kind: 1
        });
        _globalMessages.push(messageId);
    }

    function sendGroupMessage(uint256 groupId, bytes calldata encryptedPayload)
        external
        whenNotPaused
        onlyProfile
        returns (uint256 messageId)
    {
        require(groups[groupId].active);
        require(groupMember[groupId][msg.sender]);
        _validateEncrypted(encryptedPayload);
        messageId = _storeMessage({
            from: msg.sender,
            to: address(0),
            groupId: groupId,
            content: "",
            encryptedPayload: encryptedPayload,
            kind: 2
        });
        _groupMessages[groupId].push(messageId);
        groups[groupId].messageCount += 1;
    }

    function sendEncryptedMessage(address to, bytes calldata encryptedPayload)
        external
        whenNotPaused
        onlyProfile
        returns (uint256 messageId)
    {
        require(to != address(0) && profiles[to].exists);
        _validateEncrypted(encryptedPayload);
        messageId = _storeMessage({
            from: msg.sender,
            to: to,
            groupId: 0,
            content: "",
            encryptedPayload: encryptedPayload,
            kind: 3
        });
        _inbox[to].push(messageId);
        _sent[msg.sender].push(messageId);
    }

    function deletePost(uint256 postId) external whenNotPaused {
        Post storage postData = posts[postId];
        require(postData.author != address(0) && !postData.deleted);
        require(
            msg.sender == postData.author || msg.sender == owner || moderators[msg.sender]);
        postData.deleted = true;
        emit PostDeleted(postId);
    }

    function deleteComment(uint256 commentId) external whenNotPaused {
        Comment storage commentData = comments[commentId];
        require(commentData.author != address(0) && !commentData.deleted);
        Post storage postData = posts[commentData.postId];
        require(
            msg.sender == commentData.author ||
                msg.sender == postData.author ||
                msg.sender == owner ||
                moderators[msg.sender]);
        commentData.deleted = true;
        emit CommentDeleted(commentId);
    }

    function deleteMessage(uint256 messageId) external whenNotPaused {
        Message storage messageData = messages[messageId];
        require(messageData.from != address(0) && !messageData.deleted);
        bool groupPower = messageData.kind == 2 &&
            (groupAdmin[messageData.groupId][msg.sender] || groupOfficer[messageData.groupId][msg.sender]);
        require(
            msg.sender == messageData.from || msg.sender == owner || moderators[msg.sender] || groupPower);
        messageData.deleted = true;
        emit MessageDeleted(messageId);
    }

    function setChannelActive(uint256 channelId, bool active) external onlyAdmin {
        require(channels[channelId].creator != address(0));
        channels[channelId].active = active;
        emit ChannelStatusUpdated(channelId, active);
    }

    function setGroupActive(uint256 groupId, bool active) external {
        require(groups[groupId].creator != address(0));
        require(msg.sender == groups[groupId].creator || msg.sender == owner || moderators[msg.sender]);
        groups[groupId].active = active;
        emit GroupStatusUpdated(groupId, active);
    }

    function setModerator(address moderator, bool enabled) external onlyOwner {
        require(moderator != address(0));
        moderators[moderator] = enabled;
        emit ModeratorUpdated(moderator, enabled);
    }

    function setAdminVerified(address user, bool verified) external onlyAdmin {
        require(profiles[user].exists);
        profiles[user].adminVerified = verified;
        emit AdminVerified(user, verified);
    }

    function setIntegrations(address nusd_, address pixel_) external onlyOwner {
        require(nusd_ != address(0) && pixel_ != address(0));
        NUSD = nusd_;
        pixel = pixel_;
        emit IntegrationsUpdated(nusd_, pixel_);
    }

    function setVerificationRules(
        uint256 minPostLikes,
        uint256 minFollowers,
        uint256 minNUSDBalance
    ) external onlyOwner {
        minVerifiedPostLikes = minPostLikes;
        minVerifiedFollowers = minFollowers;
        minVerifiedNUSDBalance = minNUSDBalance;
        emit VerificationRulesUpdated(minPostLikes, minFollowers, minNUSDBalance);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit Paused(paused_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0));
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner);
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, owner);
    }

    function isVerified(address user) public view returns (bool) {
        Profile storage profile = profiles[user];
        if (!profile.exists) return false;
        if (profile.adminVerified) return true;
        return
            maxPostLikes[user] >= minVerifiedPostLikes &&
            followerCount[user] >= minVerifiedFollowers &&
            _safeBalanceOf(NUSD, user) >= minVerifiedNUSDBalance;
    }

    function isAvatarValid(address user) public view returns (bool) {
        Profile storage profile = profiles[user];
        if (!profile.exists || !profile.avatarEnabled) return false;
        return _safeOwnerOf(pixel, profile.avatarTokenId) == user;
    }

    function getUserPosts(address user, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        return _slice(_userPosts[user], offset, limit);
    }

    function getChannelPosts(uint256 channelId, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        return _slice(_channelPosts[channelId], offset, limit);
    }

    function getPostComments(uint256 postId, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        return _slice(_postComments[postId], offset, limit);
    }

    function getGroupMessages(uint256 groupId, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory)
    {
        require(groupMember[groupId][msg.sender] || msg.sender == owner || moderators[msg.sender]);
        return _slice(_groupMessages[groupId], offset, limit);
    }

    function getGlobalMessages(uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        return _slice(_globalMessages, offset, limit);
    }

    function getInbox(address user, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        return _slice(_inbox[user], offset, limit);
    }

    function getSent(address user, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        return _slice(_sent[user], offset, limit);
    }

    function _createPost(
        uint256 channelId,
        string calldata content,
        bool hasPixel,
        uint256 pixelTokenId
    ) internal returns (uint256 postId) {
        _validateText(content, MAX_POST_LENGTH, true);
        if (hasPixel) _requirePixelOwner(pixelTokenId, msg.sender);

        unchecked {
            ++postCount;
        }
        postId = postCount;
        posts[postId] = Post({
            author: msg.sender,
            channelId: channelId,
            pixelTokenId: pixelTokenId,
            content: content,
            createdAt: uint64(block.timestamp),
            likeCount: 0,
            commentCount: 0,
            hasPixel: hasPixel,
            deleted: false
        });
        _userPosts[msg.sender].push(postId);
        emit PostCreated(postId, msg.sender, channelId, pixelTokenId);
    }

    function _storeMessage(
        address from,
        address to,
        uint256 groupId,
        string memory content,
        bytes memory encryptedPayload,
        uint8 kind
    ) internal returns (uint256 messageId) {
        unchecked {
            ++messageCount;
        }
        messageId = messageCount;
        messages[messageId] = Message({
            from: from,
            to: to,
            groupId: groupId,
            content: content,
            encryptedPayload: encryptedPayload,
            createdAt: uint64(block.timestamp),
            kind: kind,
            deleted: false
        });
        emit MessageSent(messageId, kind, from, to, groupId);
    }

    function _validateUsername(string calldata username) internal pure returns (bytes32 nameHash) {
        bytes calldata value = bytes(username);
        require(value.length >= MIN_USERNAME_LENGTH && value.length <= MAX_USERNAME_LENGTH);
        for (uint256 i = 0; i < value.length; ) {
            bytes1 c = value[i];
            bool ok = (c >= 0x30 && c <= 0x39) ||
                (c >= 0x61 && c <= 0x7a) ||
                c == 0x5f ||
                c == 0x2e;
            require(ok);
            unchecked {
                ++i;
            }
        }
        nameHash = keccak256(value);
    }

    function _validateSlug(string calldata slug) internal pure returns (bytes32 slugHash) {
        bytes calldata value = bytes(slug);
        require(value.length > 0 && value.length <= MAX_SLUG_LENGTH);
        for (uint256 i = 0; i < value.length; ) {
            bytes1 c = value[i];
            bool ok = (c >= 0x30 && c <= 0x39) ||
                (c >= 0x61 && c <= 0x7a) ||
                c == 0x2d;
            require(ok);
            unchecked {
                ++i;
            }
        }
        slugHash = keccak256(value);
    }

    function _validateText(string calldata value, uint256 maxLength, bool required) internal pure {
        uint256 length = bytes(value).length;
        if (required) require(length > 0);
        require(length <= maxLength);
    }

    function _validateEncrypted(bytes calldata value) internal pure {
        require(value.length > 0);
        require(value.length <= MAX_ENCRYPTED_BYTES);
    }

    function _requirePixelOwner(uint256 tokenId, address account) internal view {
        require(_safeOwnerOf(pixel, tokenId) == account);
    }

    function _safeOwnerOf(address token, uint256 tokenId) internal view returns (address owner_) {
        try IERC721Owner(token).ownerOf(tokenId) returns (address result) {
            owner_ = result;
        } catch {
            owner_ = address(0);
        }
    }

    function _safeBalanceOf(address token, address account) internal view returns (uint256 balance) {
        try IERC20Balance(token).balanceOf(account) returns (uint256 result) {
            balance = result;
        } catch {
            balance = 0;
        }
    }

    function _slice(uint256[] storage source, uint256 offset, uint256 limit)
        internal
        view
        returns (uint256[] memory out)
    {
        uint256 length = source.length;
        if (offset >= length || limit == 0) return new uint256[](0);
        uint256 end = offset + limit;
        if (end > length) end = length;
        out = new uint256[](end - offset);
        for (uint256 i = offset; i < end; ) {
            out[i - offset] = source[i];
            unchecked {
                ++i;
            }
        }
    }
}

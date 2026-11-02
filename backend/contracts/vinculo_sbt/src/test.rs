#![cfg(test)]
extern crate std;

use crate::{DataKey, Error, VinculoSBT, VinculoSBTClient, TTL_EXTEND_TO};
use soroban_sdk::{
    testutils::{storage::Instance as _, storage::Persistent as _, Address as _},
    vec, Address, Env, String, Symbol, Vec,
};

const WASM: &[u8] = include_bytes!("../../target/wasm32v1-none/release/vinculo_sbt.wasm");

struct Setup {
    env: Env,
    id: Address,
    client: VinculoSBTClient<'static>,
    admin: Address,
    pauser: Address,
    minter: Address,
}

fn uris(env: &Env) -> Vec<String> {
    let mut list = vec![env];
    for name in ["bronce", "plata", "oro", "diamante", "platino"] {
        list.push_back(String::from_str(env, name));
    }
    list
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let pauser = Address::generate(&env);
    let minter = Address::generate(&env);
    let args = (admin.clone(), pauser.clone(), minter.clone(), uris(&env));
    let id = env.register(VinculoSBT, args);
    let client = VinculoSBTClient::new(&env, &id);
    Setup {
        env,
        id,
        client,
        admin,
        pauser,
        minter,
    }
}

#[test]
fn constructor_assigns_only_the_given_roles() {
    let s = setup();
    assert_eq!(s.client.get_admin(), Some(s.admin.clone()));
    let pauser = Symbol::new(&s.env, "pauser");
    let minter = Symbol::new(&s.env, "minter");
    assert!(s.client.has_role(&s.pauser, &pauser).is_some());
    assert!(s.client.has_role(&s.minter, &minter).is_some());
    assert!(s.client.has_role(&s.admin, &minter).is_none());
    assert!(s.client.has_role(&s.pauser, &minter).is_none());
}

#[test]
#[should_panic]
fn constructor_rejects_wrong_uri_count() {
    let env = Env::default();
    let a = Address::generate(&env);
    let bad: Vec<String> = vec![&env, String::from_str(&env, "solo-una")];
    env.register(VinculoSBT, (a.clone(), a.clone(), a, bad));
}

#[test]
fn minter_sets_tier_and_uri_follows() {
    let s = setup();
    let user = Address::generate(&s.env);
    assert_eq!(s.client.get_tier(&user), 0);
    assert_eq!(
        s.client.token_uri(&user),
        String::from_str(&s.env, "bronce")
    );

    s.client.mint(&s.minter, &user, &2);
    assert_eq!(s.client.get_tier(&user), 2);
    assert_eq!(s.client.token_uri(&user), String::from_str(&s.env, "oro"));
}

#[test]
fn non_minter_cannot_mint_even_the_admin() {
    let s = setup();
    let user = Address::generate(&s.env);
    assert!(s.client.try_mint(&s.admin, &user, &4).is_err());
    assert!(s.client.try_mint(&user, &user, &4).is_err());
    assert_eq!(s.client.get_tier(&user), 0);
}

#[test]
fn mint_needs_the_minter_signature() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.env.set_auths(&[]);
    assert!(s.client.try_mint(&s.minter, &user, &1).is_err());
    assert_eq!(s.client.get_tier(&user), 0);
}

#[test]
fn mint_rejects_invalid_and_repeated_tier() {
    let s = setup();
    let user = Address::generate(&s.env);
    assert_eq!(
        s.client.try_mint(&s.minter, &user, &5),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::InvalidTier as u32
        )))
    );
    s.client.mint(&s.minter, &user, &1);
    assert_eq!(
        s.client.try_mint(&s.minter, &user, &1),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::TierUnchanged as u32
        )))
    );
}

#[test]
fn revoke_returns_to_bronce_and_requires_role() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.client.mint(&s.minter, &user, &3);
    assert!(s.client.try_revoke(&user, &user).is_err());
    s.client.revoke(&s.minter, &user);
    assert_eq!(s.client.get_tier(&user), 0);
}

#[test]
fn only_pauser_pauses_and_only_admin_unpauses() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    assert!(s.client.try_pause(&stranger).is_err());
    assert!(s.client.try_pause(&s.admin).is_err());
    assert!(!s.client.paused());

    s.client.pause(&s.pauser);
    assert!(s.client.paused());

    s.env.set_auths(&[]);
    assert!(s.client.try_unpause(&s.pauser).is_err());
    assert!(s.client.paused());

    s.env.mock_all_auths();
    s.client.unpause(&s.admin);
    assert!(!s.client.paused());
}

#[test]
fn pause_blocks_mint_but_not_revoke() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.client.mint(&s.minter, &user, &1);
    s.client.pause(&s.pauser);
    assert!(s.client.try_mint(&s.minter, &user, &2).is_err());
    s.client.revoke(&s.minter, &user);
    assert_eq!(s.client.get_tier(&user), 0);
}

#[test]
fn only_admin_changes_metadata() {
    let s = setup();
    let new_uris: Vec<String> = vec![
        &s.env,
        String::from_str(&s.env, "a"),
        String::from_str(&s.env, "b"),
        String::from_str(&s.env, "c"),
        String::from_str(&s.env, "d"),
        String::from_str(&s.env, "e"),
    ];
    s.env.set_auths(&[]);
    assert!(s.client.try_set_metadata_uris(&new_uris).is_err());

    s.env.mock_all_auths();
    s.client.set_metadata_uris(&new_uris);
    let user = Address::generate(&s.env);
    assert_eq!(s.client.token_uri(&user), String::from_str(&s.env, "a"));
}

#[test]
fn writes_extend_ttl() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.client.mint(&s.minter, &user, &1);
    s.env.as_contract(&s.id, || {
        let key = DataKey::Tier(user.clone());
        assert_eq!(s.env.storage().persistent().get_ttl(&key), TTL_EXTEND_TO);
        assert_eq!(s.env.storage().instance().get_ttl(), TTL_EXTEND_TO);
    });
}

#[test]
fn upgrade_requires_admin_and_keeps_state() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let id = env.register(
        WASM,
        (admin.clone(), admin.clone(), minter.clone(), uris(&env)),
    );
    let client = VinculoSBTClient::new(&env, &id);
    let user = Address::generate(&env);
    client.mint(&minter, &user, &3);
    let hash = env.deployer().upload_contract_wasm(WASM);

    env.set_auths(&[]);
    assert!(client.try_upgrade(&hash, &minter).is_err());

    env.mock_all_auths();
    client.upgrade(&hash, &admin);
    assert_eq!(client.get_tier(&user), 3);
    assert_eq!(client.get_admin(), Some(admin.clone()));
    // Sigue siendo actualizable después del upgrade.
    client.upgrade(&hash, &admin);
}

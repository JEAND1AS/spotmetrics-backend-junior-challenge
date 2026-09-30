-module(spotmetrics_credential_validator).
-behaviour(rabbit_credential_validator).
-export([validate/2]).

%% Reject whitespace instead of silently changing the supplied credentials.
validate(Username, Password) ->
    case valid(Username) of
        false -> {error, "Username must not be empty or contain whitespace"};
        true ->
            case valid(Password) of
                false -> {error, "Password must not be empty or contain whitespace"};
                true -> ok
            end
    end.

valid(Value) when is_binary(Value), byte_size(Value) > 0 ->
    try re:run(Value, "\\A\\S+\\z", [unicode, ucp, {capture, none}]) of
        match -> true;
        _ -> false
    catch
        error:badarg -> false
    end;
valid(_) -> false.
